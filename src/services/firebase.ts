import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  User,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  setLogLevel,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  FourthwallHeaderCssSetting,
  GiftGuide,
  GuideSection,
  HtmlEditorProject,
  HtmlProjectEditorState,
  HtmlProjectSection,
  HtmlSectionCategory,
  Product,
  ProjectBackup,
  UserSettings,
} from '../types/cms';
import {
  SEED_GREEK_GUIDE,
  SEED_GREEK_SECTIONS,
  SEED_PRODUCTS,
} from '../data/greekMythologySeed';
import { DEFAULT_GIFT_GUIDE_CSS, ensureProjectHasSections } from './htmlWorkspaceEngine';
import {
  loadManagedCategories,
  migrateAndHydrateProductRecord,
} from './productCatalogTaxonomy';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
try {
  setLogLevel('silent');
} catch {
  // Ignore if setLogLevel is unavailable in test environment
}
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function isOfflineOrTokenServiceError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  const lower = msg.toLowerCase();
  return (
    lower.includes('the client is offline') ||
    lower.includes('failed to get document because the client is offline') ||
    lower.includes('token-service-api-has-not-been-used') ||
    lower.includes('securetoken.googleapis.com') ||
    lower.includes('fetching auth token failed') ||
    lower.includes('client is offline') ||
    lower.includes('unavailable') ||
    lower.includes('network-request-failed')
  );
}

export async function validateUserAuthToken(
  user: User
): Promise<{ valid: boolean; reason?: string }> {
  try {
    await user.getIdToken();
    return { valid: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error ?? '');
    try {
      await signOut(auth);
    } catch {
      // Ignore sign-out cleanup error
    }
    if (
      msg.includes('token-service-api-has-not-been-used') ||
      msg.includes('securetoken.googleapis.com')
    ) {
      return {
        valid: false,
        reason:
          'Cloud sync paused: Token Service API (securetoken.googleapis.com) is disabled in the Google Cloud project. Running in Local Storage mode.',
      };
    }
    return {
      valid: false,
      reason: 'Previous cloud session expired or could not be refreshed. Running in Local Storage mode.',
    };
  }
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  if (!isOfflineOrTokenServiceError(error)) {
    console.warn('Firestore Error: ', JSON.stringify(errInfo));
  }
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection to Firestore after auth state settles
async function testConnection() {
  try {
    if (typeof auth.authStateReady === 'function') {
      await auth.authStateReady();
    }
    if (auth.currentUser) {
      const check = await validateUserAuthToken(auth.currentUser);
      if (!check.valid) return;
    }
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch {
    // Offline or unconfigured Firestore falls back cleanly to Local Storage mode
  }
}
void testConnection();

export function sanitizeId(rawId: string): string {
  const cleaned = (rawId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
  return cleaned || `id-${Date.now()}`;
}

export async function signInWithGooglePopup(): Promise<User> {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  const tokenCheck = await validateUserAuthToken(result.user);
  if (!tokenCheck.valid) {
    throw new Error(
      tokenCheck.reason ||
        'Signed in, but Firebase Token Service API is unavailable. Running in Local Storage mode.'
    );
  }
  return result.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

export { onAuthStateChanged };
export type { User };

/**
 * Ensures the UserSettings document exists in `/users/{userId}`.
 */
export async function ensureUserSettings(user: User): Promise<UserSettings> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const fallbackSettings: UserSettings = {
    ownerId: user.uid,
    displayName: (user.displayName || user.email || 'Editor').slice(0, 120),
    defaultStoreBaseUrl: 'https://scienceofgifts.com',
    schemaVersion: 1,
  };
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data() as UserSettings;
    }
    const payload = {
      ...fallbackSettings,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, payload);
    return payload;
  } catch (error) {
    if (isOfflineOrTokenServiceError(error)) {
      return fallbackSettings;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateUserSettings(
  userId: string,
  updates: { displayName: string; defaultStoreBaseUrl: string }
): Promise<void> {
  const path = `users/${userId}`;
  const ref = doc(db, 'users', userId);
  try {
    await updateDoc(ref, {
      displayName: (updates.displayName || '').slice(0, 120),
      defaultStoreBaseUrl: (updates.defaultStoreBaseUrl || 'https://scienceofgifts.com').slice(0, 500),
      schemaVersion: 1,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

const META_DELIMITER = '\n<!--SOG_META:';
const META_END = '-->';

interface PackedProductMeta {
  originalPrice?: string;
  sku?: string;
  imageUrls?: string[];
  variants?: Product['variants'];
  lastFetchedAt?: string;
  dataSource?: Product['dataSource'];
  fetchStatus?: Product['fetchStatus'];
  priceEmpty?: boolean;
  productTypeManualOverride?: boolean;
}

function packSourceNotesWithMeta(
  cleanUserNotes: string,
  prod: Omit<Product, 'ownerId' | 'createdAt' | 'updatedAt'>
): string {
  const meta: PackedProductMeta = {};
  if (prod.originalPrice) meta.originalPrice = prod.originalPrice.slice(0, 50);
  if (prod.sku) meta.sku = prod.sku.slice(0, 120);
  if (prod.imageUrls && prod.imageUrls.length > 0) {
    meta.imageUrls = prod.imageUrls.slice(0, 8);
  }
  if (prod.variants && prod.variants.length > 0) {
    meta.variants = prod.variants.slice(0, 20);
  }
  if (prod.lastFetchedAt) meta.lastFetchedAt = prod.lastFetchedAt;
  if (prod.dataSource) meta.dataSource = prod.dataSource;
  if (prod.fetchStatus) meta.fetchStatus = prod.fetchStatus;
  if (!prod.price || prod.price.trim() === '' || prod.price.trim() === 'Unavailable') {
    meta.priceEmpty = true;
  }
  if (prod.productTypeManualOverride) {
    meta.productTypeManualOverride = true;
  }

  const hasMeta = Object.keys(meta).length > 0;
  if (!hasMeta) {
    return cleanUserNotes.slice(0, 2000);
  }

  const serializedMeta = `${META_DELIMITER}${JSON.stringify(meta)}${META_END}`;
  if (serializedMeta.length > 1800) {
    return cleanUserNotes.slice(0, 2000);
  }
  const maxNotesLen = Math.max(0, 2000 - serializedMeta.length);
  return `${cleanUserNotes.slice(0, maxNotesLen)}${serializedMeta}`;
}

export function unpackProductFromFirestoreDoc(
  rawDoc: Omit<Product, 'id'>,
  id: string
): Product {
  let cleanNotes = rawDoc.sourceNotes || '';
  let unpackedMeta: PackedProductMeta = {};

  const delimIdx = cleanNotes.indexOf(META_DELIMITER);
  if (delimIdx >= 0 && cleanNotes.endsWith(META_END)) {
    const jsonPart = cleanNotes.slice(
      delimIdx + META_DELIMITER.length,
      cleanNotes.length - META_END.length
    );
    cleanNotes = cleanNotes.slice(0, delimIdx);
    try {
      unpackedMeta = JSON.parse(jsonPart) as PackedProductMeta;
    } catch {
      unpackedMeta = {};
    }
  }

  const resolvedPrice =
    unpackedMeta.priceEmpty || rawDoc.price === 'Unavailable' ? '' : rawDoc.price;

  return migrateAndHydrateProductRecord(
    {
      ...rawDoc,
      id,
      price: resolvedPrice,
      sourceNotes: cleanNotes,
      originalPrice: unpackedMeta.originalPrice ?? rawDoc.originalPrice,
      sku: unpackedMeta.sku ?? rawDoc.sku,
      imageUrls: unpackedMeta.imageUrls ?? rawDoc.imageUrls,
      variants: unpackedMeta.variants ?? rawDoc.variants,
      lastFetchedAt: unpackedMeta.lastFetchedAt ?? rawDoc.lastFetchedAt,
      dataSource: unpackedMeta.dataSource ?? rawDoc.dataSource,
      fetchStatus: unpackedMeta.fetchStatus ?? rawDoc.fetchStatus,
      productTypeManualOverride:
        unpackedMeta.productTypeManualOverride ?? rawDoc.productTypeManualOverride,
    },
    loadManagedCategories()
  );
}

const LOCAL_PRODUCTS_STORAGE_KEY = 'sog_catalog_products_v2';

export function loadLocalCatalogProducts(): Product[] | null {
  const cached = getCachedCatalogProductsSync();
  if (!cached) return null;
  const managedCats = loadManagedCategories();
  return cached.map((p) => migrateAndHydrateProductRecord(p, managedCats));
}

export async function loadLocalCatalogProductsAsync(): Promise<Product[] | null> {
  const hydrated = await hydrateCatalogProductsFromIdb();
  if (!hydrated) return null;
  const managedCats = loadManagedCategories();
  return hydrated.map((p) => migrateAndHydrateProductRecord(p, managedCats));
}

export function saveLocalCatalogProducts(products: Product[]): void {
  void saveCatalogProductsToIdb(products).catch(() => {
    // Best-effort background catalog cache persistence
  });
}

/**
 * Sanitizes a Product payload to strictly match `firebase-blueprint.json` and `firestore.rules`.
 */
function sanitizeProductPayload(
  userId: string,
  prod: Omit<Product, 'ownerId' | 'createdAt' | 'updatedAt'>
) {
  const cleanTags = (prod.tags || [])
    .map((t) => String(t).trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 20);

  const rawUserNotes = (prod.sourceNotes || '').split(META_DELIMITER)[0].trim();
  const packedSourceNotes = packSourceNotesWithMeta(rawUserNotes, prod);

  const firestorePrice = (prod.price || '').trim()
    ? prod.price.trim().slice(0, 50)
    : 'Unavailable';

  return {
    ownerId: userId,
    name: (prod.name || 'Untitled Product').trim().slice(0, 300),
    productUrl: (prod.productUrl || '/products/untitled').trim().slice(0, 1000),
    imageUrl: (prod.imageUrl || '').trim().slice(0, 2000),
    price: firestorePrice,
    currency: (prod.currency || 'USD').trim().slice(0, 10),
    productType: (prod.productType || 'General').trim().slice(0, 120),
    category: (prod.category || 'General').trim().slice(0, 120),
    tags: cleanTags,
    shortDescription: (prod.shortDescription || '').trim().slice(0, 2000),
    featuresSpecs: (prod.featuresSpecs || '').trim().slice(0, 3000),
    sourceNotes: packedSourceNotes,
    archived: Boolean(prod.archived),
  };
}

export async function saveProductToFirestore(
  userId: string,
  product: Omit<Product, 'ownerId' | 'createdAt' | 'updatedAt'>,
  isExisting = false
): Promise<string> {
  const prodId = sanitizeId(product.id);
  const path = `users/${userId}/products/${prodId}`;
  const ref = doc(db, 'users', userId, 'products', prodId);
  const base = sanitizeProductPayload(userId, { ...product, id: prodId });

  try {
    if (isExisting) {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const { ownerId: _o, ...mutableFields } = base;
        await updateDoc(ref, {
          ...mutableFields,
          updatedAt: serverTimestamp(),
        });
        return prodId;
      }
    }
    await setDoc(ref, {
      ...base,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return prodId;
  } catch (error) {
    if (isOfflineOrTokenServiceError(error)) {
      return prodId;
    }
    handleFirestoreError(error, isExisting ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function deleteProductFromFirestore(userId: string, productId: string): Promise<void> {
  const path = `users/${userId}/products/${productId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'products', productId));
  } catch (error) {
    if (isOfflineOrTokenServiceError(error)) {
      return;
    }
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeToProducts(
  userId: string,
  onData: (products: Product[]) => void,
  onError?: (err: Error) => void
) {
  const path = `users/${userId}/products`;
  const q = query(collection(db, 'users', userId, 'products'), where('ownerId', '==', userId));
  return onSnapshot(
    q,
    (snap) => {
      const items: Product[] = snap.docs.map((d) =>
        unpackProductFromFirestoreDoc(d.data() as Omit<Product, 'id'>, d.id)
      );
      items.sort((a, b) => a.name.localeCompare(b.name));
      saveLocalCatalogProducts(items);
      onData(items);
    },
    (err) => {
      if (onError) onError(err);
      if (isOfflineOrTokenServiceError(err)) return;
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

function sanitizeGuidePayload(
  userId: string,
  guide: Omit<GiftGuide, 'ownerId' | 'createdAt' | 'updatedAt'>
) {
  return {
    ownerId: userId,
    title: (guide.title || 'Untitled Gift Guide').trim().slice(0, 300),
    topic: (guide.topic || 'General').trim().slice(0, 200),
    audience: (guide.audience || '').trim().slice(0, 500),
    slug: (guide.slug || 'gift-guide').trim().slice(0, 200),
    canonicalUrl: (guide.canonicalUrl || 'https://scienceofgifts.com/pages/gift-guide')
      .trim()
      .slice(0, 1000),
    storeBaseUrl: (guide.storeBaseUrl || 'https://scienceofgifts.com').trim().slice(0, 500),
    collectionUrl: (guide.collectionUrl || '/collections/all').trim().slice(0, 500),
    introText: (guide.introText || '').trim().slice(0, 5000),
    sectionCount: Math.max(0, Math.min(100, Number(guide.sectionCount || 0))),
    productCount: Math.max(0, Math.min(1000, Number(guide.productCount || 0))),
    schemaConfig: guide.schemaConfig || {
      siteBaseUrl: 'https://scienceofgifts.com',
      breadcrumbs: [],
      itemListName: guide.title || 'Gift Guide',
      itemListDescription: '',
      includedProductIds: [],
    },
    schemaVersion: 1,
  };
}

function sanitizeSectionPayload(
  userId: string,
  guideId: string,
  sec: Omit<GuideSection, 'ownerId' | 'createdAt' | 'updatedAt'>
) {
  return {
    ownerId: userId,
    guideId: sanitizeId(guideId),
    type: sec.type,
    title: (sec.title || 'Untitled Section').trim().slice(0, 300),
    anchorId: (sec.anchorId || `jump-${sec.id}`).trim().replace(/^#/, '').slice(0, 120),
    order: Math.max(0, Math.min(500, Number(sec.order || 0))),
    enabled: Boolean(sec.enabled),
    config: sec.config || {},
  };
}

export function subscribeToGuides(
  userId: string,
  onData: (guides: GiftGuide[]) => void,
  onError?: (err: Error) => void
) {
  const path = `users/${userId}/guides`;
  const q = query(collection(db, 'users', userId, 'guides'), where('ownerId', '==', userId));
  return onSnapshot(
    q,
    (snap) => {
      const items: GiftGuide[] = snap.docs.map((d) => ({
        ...(d.data() as Omit<GiftGuide, 'id'>),
        id: d.id,
      }));
      items.sort((a, b) => a.title.localeCompare(b.title));
      onData(items);
    },
    (err) => {
      if (onError) onError(err);
      if (isOfflineOrTokenServiceError(err)) return;
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

export async function fetchGuideWithSections(
  userId: string,
  guideId: string
): Promise<{ guide: GiftGuide; sections: GuideSection[] }> {
  const cleanGuideId = sanitizeId(guideId);
  const guidePath = `users/${userId}/guides/${cleanGuideId}`;
  try {
    const guideSnap = await getDoc(doc(db, 'users', userId, 'guides', cleanGuideId));
    if (!guideSnap.exists()) {
      throw new Error(`Gift Guide "${cleanGuideId}" not found.`);
    }
    const guide: GiftGuide = {
      ...(guideSnap.data() as Omit<GiftGuide, 'id'>),
      id: guideSnap.id,
    };

    const sectionsPath = `users/${userId}/guides/${cleanGuideId}/sections`;
    const secQuery = query(
      collection(db, 'users', userId, 'guides', cleanGuideId, 'sections'),
      where('ownerId', '==', userId)
    );
    const secSnap = await getDocs(secQuery);
    const sections: GuideSection[] = secSnap.docs
      .map((d) => ({
        ...(d.data() as Omit<GuideSection, 'id'>),
        id: d.id,
      }))
      .sort((a, b) => a.order - b.order);

    return { guide, sections };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, guidePath);
  }
}

/**
 * Saves a GiftGuide and all its GuideSections atomically (handling creates, updates, and removed sections).
 */
export async function saveCompleteGuideProject(
  userId: string,
  guide: Omit<GiftGuide, 'ownerId' | 'createdAt' | 'updatedAt'>,
  sections: Array<Omit<GuideSection, 'ownerId' | 'createdAt' | 'updatedAt'>>,
  deletedSectionIds: string[] = []
): Promise<void> {
  const cleanGuideId = sanitizeId(guide.id);
  const guideRef = doc(db, 'users', userId, 'guides', cleanGuideId);
  const guidePath = `users/${userId}/guides/${cleanGuideId}`;

  // Count distinct referenced product IDs across all sections
  const distinctProductIds = new Set<string>();
  for (const sec of sections) {
    const cfg = sec.config || {};
    (cfg.quickPickCards || []).forEach((c) => c.productId && distinctProductIds.add(c.productId));
    if (cfg.editorsPick?.productId) distinctProductIds.add(cfg.editorsPick.productId);
    (cfg.editorialItems || []).forEach((i) => i.productId && distinctProductIds.add(i.productId));
    (cfg.attachedMoreGrids || []).forEach((g) =>
      (g.items || []).forEach((i) => i.productId && distinctProductIds.add(i.productId))
    );
    (cfg.moreGridItems || []).forEach((i) => i.productId && distinctProductIds.add(i.productId));
    (cfg.categoryCards || []).forEach((c) => {
      if (c.thumbnailProductId) distinctProductIds.add(c.thumbnailProductId);
      (c.links || []).forEach((l) => l.productId && distinctProductIds.add(l.productId));
    });
  }

  const normalizedGuide = sanitizeGuidePayload(userId, {
    ...guide,
    id: cleanGuideId,
    sectionCount: sections.length,
    productCount: distinctProductIds.size,
  });

  try {
    // 1. Ensure parent Guide document exists first so subcollection Master Gate rules pass
    const existingGuideSnap = await getDoc(guideRef);
    if (existingGuideSnap.exists()) {
      const { ownerId: _o, ...mutableGuide } = normalizedGuide;
      await updateDoc(guideRef, {
        ...mutableGuide,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(guideRef, {
        ...normalizedGuide,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    // 2. Delete any removed sections
    for (const delId of deletedSectionIds) {
      const cleanDelId = sanitizeId(delId);
      await deleteDoc(doc(db, 'users', userId, 'guides', cleanGuideId, 'sections', cleanDelId));
    }

    // 3. Upsert each section
    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      const cleanSecId = sanitizeId(sec.id);
      const secRef = doc(db, 'users', userId, 'guides', cleanGuideId, 'sections', cleanSecId);
      const secBase = sanitizeSectionPayload(userId, cleanGuideId, {
        ...sec,
        id: cleanSecId,
        order: i,
      });

      const existingSecSnap = await getDoc(secRef);
      if (existingSecSnap.exists()) {
        const { ownerId: _o, guideId: _g, ...mutableSec } = secBase;
        await updateDoc(secRef, {
          ...mutableSec,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(secRef, {
          ...secBase,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, guidePath);
  }
}

export async function deleteGuideProject(userId: string, guideId: string): Promise<void> {
  const cleanGuideId = sanitizeId(guideId);
  const guidePath = `users/${userId}/guides/${cleanGuideId}`;
  try {
    // Delete child sections first while parent still exists (required by Master Gate delete rule)
    const secQuery = query(
      collection(db, 'users', userId, 'guides', cleanGuideId, 'sections'),
      where('ownerId', '==', userId)
    );
    const secSnap = await getDocs(secQuery);
    for (const secDoc of secSnap.docs) {
      await deleteDoc(secDoc.ref);
    }
    await deleteDoc(doc(db, 'users', userId, 'guides', cleanGuideId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, guidePath);
  }
}

/**
 * Seeds the complete Greek Mythology Gift Guide and Product Library from the Handover Document.
 */
export async function seedGreekMythologySampleProject(userId: string): Promise<string> {
  // 1. Seed products in batches
  const batch = writeBatch(db);
  for (const prod of SEED_PRODUCTS) {
    const prodId = sanitizeId(prod.id);
    const ref = doc(db, 'users', userId, 'products', prodId);
    const base = sanitizeProductPayload(userId, { ...prod, id: prodId });
    batch.set(ref, {
      ...base,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${userId}/products`);
  }

  // 2. Save the Greek Mythology Guide and its 9 sections
  await saveCompleteGuideProject(userId, SEED_GREEK_GUIDE, SEED_GREEK_SECTIONS);
  return SEED_GREEK_GUIDE.id;
}

/**
 * Creates a brand-new Gift Guide project with a clean starter section structure.
 */
export async function createNewGuideProject(
  userId: string,
  params: {
    title: string;
    topic: string;
    audience: string;
    slug: string;
    storeBaseUrl: string;
    collectionUrl: string;
  }
): Promise<string> {
  const guideId = sanitizeId(`guide-${params.slug || params.title}-${Date.now().toString(36)}`);
  const baseUrl = (params.storeBaseUrl || 'https://scienceofgifts.com').replace(/\/+$/, '');
  const cleanSlug = (params.slug || params.title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const canonicalUrl = `${baseUrl}/pages/${cleanSlug || 'gift-guide'}`;

  const starterSections: Array<Omit<GuideSection, 'ownerId' | 'createdAt' | 'updatedAt'>> = [
    {
      id: `sec-bookmarks-${Date.now().toString(36)}`,
      guideId,
      type: 'bookmarks',
      title: 'In This Gift Guide — Quick Bookmarks',
      anchorId: 'jump-toc',
      order: 0,
      enabled: true,
      config: {
        tocTitle: `📖 In This ${params.topic} Gift Guide — Quick Bookmarks`,
        bookmarks: [
          { id: 'bm-1', prefixIcon: '⚡', label: 'Quick Picks', anchorTarget: '#jump-quick-picks', order: 0, enabled: true },
          { id: 'bm-2', prefixIcon: '🏆', label: 'Our #1 Editor’s Pick', anchorTarget: '#jump-editors-pick', order: 1, enabled: true },
          { id: 'bm-3', prefixIcon: '👕', label: `Part 1: Featured ${params.topic} Gifts`, anchorTarget: '#jump-part-1', order: 2, enabled: true },
          { id: 'bm-4', prefixIcon: '🏛️', label: `Browse by ${params.topic} Theme`, anchorTarget: '#jump-category-hub', order: 3, enabled: true },
          { id: 'bm-5', prefixIcon: '🧭', label: 'Buying Guide & FAQs', anchorTarget: '#jump-faq', order: 4, enabled: true },
        ],
      },
    },
    {
      id: `sec-qp-${Date.now().toString(36)}`,
      guideId,
      type: 'quick_picks',
      title: `Quick Picks: Best ${params.topic} Gifts`,
      anchorId: 'jump-quick-picks',
      order: 1,
      enabled: true,
      config: {
        quickPicksHeading: `⚡ Quick Picks: Best ${params.topic} Gifts`,
        quickPickCards: [],
      },
    },
    {
      id: `sec-ep-${Date.now().toString(36)}`,
      guideId,
      type: 'editors_pick',
      title: "Our #1 Pick / Editor's Spotlight",
      anchorId: 'jump-editors-pick',
      order: 2,
      enabled: true,
      config: {
        editorsPick: {
          productId: '',
          kicker: `🏆 Our #1 Pick: Best Overall ${params.topic} Gift`,
          heading: `Featured ${params.topic} Spotlight Gift`,
          description: 'Select a product from your Product Library and craft or generate your spotlight review copy.',
          priceDisplay: '$39.90',
          ctaLabel: 'Shop Our #1 Pick →',
          productUrlOverride: '/products/featured-gift',
          imageUrlOverride: '',
        },
      },
    },
    {
      id: `sec-ed1-${Date.now().toString(36)}`,
      guideId,
      type: 'editorial_list',
      title: `Part 1: Featured ${params.topic} Gifts`,
      anchorId: 'jump-part-1',
      order: 3,
      enabled: true,
      config: {
        chapterKicker: `CHAPTER 01 • ${params.topic.toUpperCase()}`,
        chapterTitle: `Part 1: Essential ${params.topic} Gifts`,
        sectionIntro: `Our top long-form editorial picks for ${params.topic.toLowerCase()} enthusiasts.`,
        editorialItems: [],
        attachedMoreGrids: [],
      },
    },
    {
      id: `sec-hub-${Date.now().toString(36)}`,
      guideId,
      type: 'category_hub',
      title: `Find Gifts by ${params.topic} Era or Theme`,
      anchorId: 'jump-category-hub',
      order: 4,
      enabled: true,
      config: {
        hubHeading: `Find Gifts by ${params.topic} Theme`,
        hubIntroHtml: `Explore curated sub-themes or <a href="${params.collectionUrl || '/collections/all'}"><strong>browse the full collection →</strong></a>`,
        categoryCards: [],
      },
    },
    {
      id: `sec-faq-${Date.now().toString(36)}`,
      guideId,
      type: 'buying_guide',
      title: 'Buying Guide & Open Editorial FAQs',
      anchorId: 'jump-faq',
      order: 5,
      enabled: true,
      config: {
        buyingGuide: {
          kicker: '🧭 Buying Guide',
          title: `How to Choose the Right ${params.topic} Gift`,
          introHtml: `Use these three pillars to choose a thoughtful ${params.topic.toLowerCase()} piece they will actually use.`,
          pillars: [
            {
              id: 'pil-1',
              numberLabel: '01 / MATCH THEIR ERA OR FOCUS',
              heading: 'Start with Their Favorite Era or Figure',
              bodyHtml: 'Identify the specific historical period, figure, or sub-discipline they read about most.',
              order: 0,
            },
            {
              id: 'pil-2',
              numberLabel: '02 / FAVOR SUBTLE LORE',
              heading: 'Choose Insider Nods Over Loud Clip-Art',
              bodyHtml: 'Look for archival typography, numismatic crests, and authentic iconography.',
              order: 1,
            },
            {
              id: 'pil-3',
              numberLabel: '03 / EVERYDAY UTILITY',
              heading: 'Prioritize Heavyweight Materials',
              bodyHtml: 'Pair meaningful motifs with 9.4 oz fleeces, lay-flat notebooks, or weighted glassware.',
              order: 2,
            },
          ],
        },
        includeFaqsInSection: true,
        faqHeaderTitle: `Frequently Asked Questions About ${params.topic} Gifts`,
        faqHeaderSubtitle: 'Quick answers on materials, sizing, and choosing the right piece.',
        faqItems: [
          {
            id: 'faq-1',
            badge: 'Q01',
            question: `What makes a good ${params.topic.toLowerCase()} gift for adults?`,
            answerHtml: `The best ${params.topic.toLowerCase()} gifts combine authentic historical or literary references with elevated everyday goods.`,
            order: 0,
          },
        ],
      },
    },
  ];

  const newGuide: Omit<GiftGuide, 'ownerId' | 'createdAt' | 'updatedAt'> = {
    id: guideId,
    title: params.title,
    topic: params.topic,
    audience: params.audience,
    slug: cleanSlug || 'gift-guide',
    canonicalUrl,
    storeBaseUrl: baseUrl,
    collectionUrl: params.collectionUrl || '/collections/all',
    introText: `Curated editorial gift guide for ${params.topic}.`,
    sectionCount: starterSections.length,
    productCount: 0,
    schemaVersion: 1,
    schemaConfig: {
      siteBaseUrl: baseUrl,
      breadcrumbs: [
        { id: 'bc-1', name: 'Home', url: `${baseUrl}/` },
        { id: 'bc-2', name: 'Gift Guides', url: `${baseUrl}/pages/gift-guides` },
        { id: 'bc-3', name: params.title, url: canonicalUrl },
      ],
      itemListName: params.title,
      itemListDescription: `Curated ${params.topic} gift guide.`,
      includedProductIds: [],
    },
  };

  await saveCompleteGuideProject(userId, newGuide, starterSections);
  return guideId;
}

/**
 * Duplicates an existing guide and all of its sections into a new independent guide project.
 */
export async function duplicateGuideProject(userId: string, sourceGuideId: string): Promise<string> {
  const { guide, sections } = await fetchGuideWithSections(userId, sourceGuideId);
  const newGuideId = sanitizeId(`${guide.id}-copy-${Date.now().toString(36).slice(-4)}`);
  const newSlug = `${guide.slug}-copy`;

  const duplicatedGuide: Omit<GiftGuide, 'ownerId' | 'createdAt' | 'updatedAt'> = {
    ...guide,
    id: newGuideId,
    title: `${guide.title} (Copy)`,
    slug: newSlug,
    canonicalUrl: `${guide.storeBaseUrl.replace(/\/+$/, '')}/pages/${newSlug}`,
  };

  const duplicatedSections: Array<Omit<GuideSection, 'ownerId' | 'createdAt' | 'updatedAt'>> =
    sections.map((sec, idx) => ({
      ...sec,
      id: sanitizeId(`${sec.id}-copy-${idx}`),
      guideId: newGuideId,
    }));

  await saveCompleteGuideProject(userId, duplicatedGuide, duplicatedSections);
  return newGuideId;
}

/**
 * Builds a structured ProjectBackup JSON object for download.
 */
export function buildProjectBackupJson(
  guide: GiftGuide,
  sections: GuideSection[],
  products: Product[]
): ProjectBackup {
  const { ownerId: _go, createdAt: _gc, updatedAt: _gu, ...cleanGuide } = guide;
  const cleanSections = sections.map(({ ownerId: _so, createdAt: _sc, updatedAt: _su, ...rest }) => rest);
  const cleanProducts = products.map(({ ownerId: _po, createdAt: _pc, updatedAt: _pu, ...rest }) => rest);

  return {
    backupFormat: 'science-of-gifts-cms-v1',
    exportedAt: new Date().toISOString(),
    guide: cleanGuide,
    sections: cleanSections,
    products: cleanProducts,
  };
}

/**
 * Validates an uploaded JSON backup string before restoring.
 */
export function validateProjectBackupJson(rawJson: string): {
  valid: boolean;
  error?: string;
  backup?: ProjectBackup;
} {
  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== 'object') {
      return { valid: false, error: 'Backup file is not a valid JSON object.' };
    }
    if (parsed.backupFormat !== 'science-of-gifts-cms-v1') {
      return {
        valid: false,
        error: 'Unrecognized backup format. Expected "science-of-gifts-cms-v1" project backup (not an HTML export).',
      };
    }
    if (!parsed.guide || !parsed.guide.id || !parsed.guide.title) {
      return { valid: false, error: 'Backup is missing required guide metadata (id, title).' };
    }
    if (!Array.isArray(parsed.sections)) {
      return { valid: false, error: 'Backup is missing the sections array.' };
    }
    if (!Array.isArray(parsed.products)) {
      return { valid: false, error: 'Backup is missing the products array.' };
    }
    return { valid: true, backup: parsed as ProjectBackup };
  } catch (err) {
    return {
      valid: false,
      error: `Invalid JSON syntax: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Restores a validated ProjectBackup into Firestore.
 */
export async function restoreProjectBackupToFirestore(
  userId: string,
  backup: ProjectBackup,
  importProducts = true
): Promise<string> {
  if (importProducts && backup.products.length > 0) {
    for (const prod of backup.products) {
      await saveProductToFirestore(userId, prod, true);
    }
  }
  await saveCompleteGuideProject(userId, backup.guide, backup.sections);
  return sanitizeId(backup.guide.id);
}

// ============================================================================
// PERSISTENT HTML EDITOR PROJECTS (INDEXEDDB + CLOUD FIRESTORE)
// ============================================================================

import {
  DEFAULT_HTML_EDITOR_STATE,
  FOURTHWALL_HEADER_CSS_UPDATED_EVENT,
  GLOBAL_FOURTHWALL_HEADER_CSS_KEY,
  LEGACY_LOCAL_HTML_PROJECTS_KEY,
  LOCAL_ACTIVE_HTML_PROJECT_ID_KEY,
  LOCAL_HTML_PROJECTS_MIGRATED_KEY,
  MAX_SINGLE_HTML_FIELD_CHARS,
  StorageDiagnosticError,
  classifyStorageFailure,
  createMockIndexedDbFactory,
  getActiveHtmlProjectIdAsync,
  getActiveLocalHtmlProjectId as getActiveLocalHtmlProjectIdFromIdb,
  getCachedCatalogProductsSync,
  getCachedFourthwallHeaderCssSync,
  getCachedHtmlProjectsSync,
  getDefaultFourthwallHeaderCssSetting,
  hydrateCatalogProductsFromIdb,
  hydrateFourthwallHeaderCssFromIdb,
  hydrateHtmlProjectsFromIdb,
  migrateLocalStorageProjectsToIdb,
  normalizeEditorState,
  removeHtmlProjectFromIdb,
  restorePreviousFourthwallHeaderCssInIdb,
  saveCatalogProductsToIdb,
  saveFourthwallHeaderCssToIdb,
  saveHtmlProjectToIdb,
  saveHtmlProjectsBatchToIdb,
  setActiveLocalHtmlProjectId as setActiveLocalHtmlProjectIdInIdb,
  setSimulatedIdbFailureForTesting,
  simulateBrowserReloadForTesting,
} from './projectStorageIdb';

export const LOCAL_HTML_PROJECTS_STORAGE_KEY = LEGACY_LOCAL_HTML_PROJECTS_KEY;
export const FIRESTORE_GLOBAL_HEADER_CSS_DOC_ID = 'sog-global-fourthwall-header-css';
export {
  DEFAULT_HTML_EDITOR_STATE,
  FOURTHWALL_HEADER_CSS_UPDATED_EVENT,
  GLOBAL_FOURTHWALL_HEADER_CSS_KEY,
  LOCAL_ACTIVE_HTML_PROJECT_ID_KEY,
  LOCAL_HTML_PROJECTS_MIGRATED_KEY,
  MAX_SINGLE_HTML_FIELD_CHARS,
  StorageDiagnosticError,
  classifyStorageFailure,
  createMockIndexedDbFactory,
  getActiveHtmlProjectIdAsync,
  getCachedCatalogProductsSync,
  getCachedFourthwallHeaderCssSync,
  getDefaultFourthwallHeaderCssSetting,
  hydrateCatalogProductsFromIdb,
  hydrateFourthwallHeaderCssFromIdb,
  hydrateHtmlProjectsFromIdb,
  migrateLocalStorageProjectsToIdb,
  restorePreviousFourthwallHeaderCssInIdb,
  saveCatalogProductsToIdb,
  saveFourthwallHeaderCssToIdb,
  setSimulatedIdbFailureForTesting,
  simulateBrowserReloadForTesting,
};

export function validateHtmlProjectForSave(
  project: Pick<HtmlEditorProject, 'id' | 'name' | 'currentHtml' | 'originalHtml' | 'baseUrl'>
): { valid: boolean; error?: string } {
  if (!project.id || !project.id.trim()) {
    return { valid: false, error: 'Project ID is required.' };
  }
  const cleanName = (project.name || '').trim();
  if (!cleanName) {
    return { valid: false, error: 'Project name cannot be empty.' };
  }
  if (cleanName.length > 300) {
    return { valid: false, error: 'Project name exceeds maximum length (300 characters).' };
  }
  if (typeof project.currentHtml !== 'string') {
    return { valid: false, error: 'Current HTML content must be a string.' };
  }
  if (typeof project.originalHtml !== 'string') {
    return { valid: false, error: 'Original HTML content must be a string.' };
  }
  if ((project.baseUrl || '').length > 1000) {
    return { valid: false, error: 'Base URL exceeds maximum length (1000 characters).' };
  }
  return { valid: true };
}

/**
 * Synchronous project list reader backed by IndexedDB cache (and automatic one-time migration
 * if legacy `localStorage` project data is detected).
 */
export function loadLocalHtmlProjects(): HtmlEditorProject[] {
  return getCachedHtmlProjectsSync();
}

/**
 * Asynchronous project list loader that ensures IndexedDB and any one-time `localStorage` migration
 * have completed before returning all stored HTML projects.
 */
export async function loadHtmlProjectsAsync(): Promise<HtmlEditorProject[]> {
  return hydrateHtmlProjectsFromIdb();
}

export const loadLocalHtmlProjectsAsync = loadHtmlProjectsAsync;

export function getActiveLocalHtmlProjectId(): string | null {
  return getActiveLocalHtmlProjectIdFromIdb();
}

export function setActiveLocalHtmlProjectId(projectId: string): void {
  setActiveLocalHtmlProjectIdInIdb(projectId);
}

/**
 * Syncs a batch of HTML projects into IndexedDB without storing project HTML in `localStorage`.
 * Returns a Promise so callers can await completion and handle any storage failure explicitly.
 */
export async function saveLocalHtmlProjectsList(
  projects: HtmlEditorProject[]
): Promise<HtmlEditorProject[]> {
  return saveHtmlProjectsBatchToIdb(projects);
}

const FIRESTORE_SINGLE_DOC_MAX_FIELD_CHARS = 320_000;
const FIRESTORE_SINGLE_DOC_MAX_TOTAL_BYTES = 750_000;
const FIRESTORE_CHUNK_SLICE_CHARS = 240_000;
const FIRESTORE_PARENT_PREVIEW_CHARS = 80_000;

export interface FirestoreHtmlProjectPayloadPlan {
  isChunked: boolean;
  parentId: string;
  parentPayload: {
    ownerId: string;
    name: string;
    currentHtml: string;
    originalHtml: string;
    baseUrl: string;
    editorState: Record<string, unknown>;
  };
  chunkDocs: Array<{
    id: string;
    payload: {
      ownerId: string;
      name: string;
      currentHtml: string;
      originalHtml: string;
      baseUrl: string;
      editorState: Record<string, unknown>;
    };
  }>;
}

interface ChunkedPayloadEnvelope {
  currentHtml: string;
  originalHtml: string;
  customCss?: string;
  sections?: HtmlProjectSection[];
}

function buildCompactSingleDocEditorState(state: HtmlProjectEditorState): Record<string, unknown> {
  const compactSections = state.sections?.map((sec) => {
    if (sec.originalHtml === sec.htmlContent) {
      const { originalHtml: _omitted, ...rest } = sec;
      return rest;
    }
    return sec;
  });
  return {
    viewMode: state.viewMode,
    selectedBlockId: state.selectedBlockId,
    sidebarTab: state.sidebarTab,
    previewViewport: state.previewViewport,
    includeFourthwallCss: state.includeFourthwallCss,
    ...(typeof state.customCss === 'string' ? { customCss: state.customCss } : {}),
    ...(compactSections ? { sections: compactSections } : {}),
    ...(state.sectionStartingNumbers
      ? { sectionStartingNumbers: state.sectionStartingNumbers }
      : {}),
  };
}

/**
 * Builds either a single Firestore document payload (for standard guides) or a backward-compatible
 * parent + chunked part documents plan (for guides that exceed single-document Firestore / rules limits).
 * Every generated document strictly adheres to `isValidHtmlProject(data)` in `firestore.rules`.
 */
export function buildFirestoreHtmlProjectPayloads(
  userId: string,
  project: HtmlEditorProject
): FirestoreHtmlProjectPayloadPlan {
  const cleanId = sanitizeId(project.id);
  const cleanName = (project.name || 'Untitled Project').trim().slice(0, 300);
  const cleanBaseUrl = (project.baseUrl || 'https://scienceofgifts.com').trim().slice(0, 1000);
  const normalizedState = normalizeEditorState(
    project.editorState,
    project.sections,
    project.customCss ?? project.editorState?.customCss
  );

  const currentHtml = project.currentHtml || '';
  const originalHtml = project.originalHtml || '';
  const compactState = buildCompactSingleDocEditorState(normalizedState);

  const singleDocCandidate = {
    ownerId: userId,
    name: cleanName,
    currentHtml,
    originalHtml,
    baseUrl: cleanBaseUrl,
    editorState: compactState,
  };

  const candidateJsonBytes = JSON.stringify(singleDocCandidate).length;
  const fitsSingleDoc =
    currentHtml.length <= FIRESTORE_SINGLE_DOC_MAX_FIELD_CHARS &&
    originalHtml.length <= FIRESTORE_SINGLE_DOC_MAX_FIELD_CHARS &&
    candidateJsonBytes <= FIRESTORE_SINGLE_DOC_MAX_TOTAL_BYTES;

  if (fitsSingleDoc) {
    return {
      isChunked: false,
      parentId: cleanId,
      parentPayload: singleDocCandidate,
      chunkDocs: [],
    };
  }

  const envelope: ChunkedPayloadEnvelope = {
    currentHtml,
    originalHtml,
    customCss: normalizedState.customCss,
    sections: normalizedState.sections,
  };
  const serializedEnvelope = JSON.stringify(envelope);
  const slices: string[] = [];
  for (let offset = 0; offset < serializedEnvelope.length; offset += FIRESTORE_CHUNK_SLICE_CHARS) {
    slices.push(serializedEnvelope.slice(offset, offset + FIRESTORE_CHUNK_SLICE_CHARS));
  }
  if (slices.length === 0) {
    slices.push('{}');
  }

  const totalParts = slices.length;
  const basePrefix = cleanId.slice(0, 95);
  const partIds = slices.map((_, idx) => `${basePrefix}--part-${idx}`);

  const chunkDocs = slices.map((slice, idx) => ({
    id: partIds[idx],
    payload: {
      ownerId: userId,
      name: `[Chunk ${idx + 1}/${totalParts}] ${cleanName}`.slice(0, 300),
      currentHtml: slice,
      originalHtml: '',
      baseUrl: cleanBaseUrl,
      editorState: {
        isChunkPart: true,
        parentProjectId: cleanId,
        partIndex: idx,
        totalParts,
      },
    },
  }));

  // Parent editorState must have <= 15 keys per firestore.rules
  const parentEditorState: Record<string, unknown> = {
    viewMode: normalizedState.viewMode,
    selectedBlockId: normalizedState.selectedBlockId,
    sidebarTab: normalizedState.sidebarTab,
    previewViewport: normalizedState.previewViewport,
    includeFourthwallCss: normalizedState.includeFourthwallCss,
    ...(normalizedState.sectionStartingNumbers
      ? { sectionStartingNumbers: normalizedState.sectionStartingNumbers }
      : {}),
    isChunkedParent: true,
    chunkTotalParts: totalParts,
    chunkPartIds: partIds,
  };

  return {
    isChunked: true,
    parentId: cleanId,
    parentPayload: {
      ownerId: userId,
      name: cleanName,
      currentHtml: currentHtml.slice(0, FIRESTORE_PARENT_PREVIEW_CHARS),
      originalHtml: originalHtml.slice(0, FIRESTORE_PARENT_PREVIEW_CHARS),
      baseUrl: cleanBaseUrl,
      editorState: parentEditorState,
    },
    chunkDocs,
  };
}

async function upsertHtmlProjectDoc(
  userId: string,
  docId: string,
  payload: FirestoreHtmlProjectPayloadPlan['parentPayload']
): Promise<void> {
  const ref = doc(db, 'users', userId, 'htmlProjects', docId);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const { ownerId: _o, ...mutableFields } = payload;
    await updateDoc(ref, {
      ...mutableFields,
      updatedAt: serverTimestamp(),
    });
  } else {
    await setDoc(ref, {
      ...payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

export async function saveHtmlProjectToFirestore(
  userId: string,
  project: HtmlEditorProject
): Promise<string> {
  const plan = buildFirestoreHtmlProjectPayloads(userId, project);
  const path = `users/${userId}/htmlProjects/${plan.parentId}`;

  try {
    // Clean up any stale chunk documents if the project previously had more chunks
    const parentRef = doc(db, 'users', userId, 'htmlProjects', plan.parentId);
    const existingParentSnap = await getDoc(parentRef);
    const oldPartIds: string[] = Array.isArray(
      existingParentSnap.exists() ? existingParentSnap.data()?.editorState?.chunkPartIds : undefined
    )
      ? (existingParentSnap.data()?.editorState?.chunkPartIds as string[])
      : [];

    // Write chunk documents first so parent snapshot readers always find complete parts
    const activePartIdSet = new Set<string>();
    for (const chunkDoc of plan.chunkDocs) {
      activePartIdSet.add(chunkDoc.id);
      await upsertHtmlProjectDoc(userId, chunkDoc.id, chunkDoc.payload);
    }

    // Write parent document
    if (existingParentSnap.exists()) {
      const { ownerId: _o, ...mutableFields } = plan.parentPayload;
      await updateDoc(parentRef, {
        ...mutableFields,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(parentRef, {
        ...plan.parentPayload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    // Remove any obsolete chunk documents from previous larger saves
    for (const oldPartId of oldPartIds) {
      if (typeof oldPartId === 'string' && !activePartIdSet.has(oldPartId)) {
        try {
          await deleteDoc(doc(db, 'users', userId, 'htmlProjects', oldPartId));
        } catch {
          // Best-effort cleanup of obsolete chunk part
        }
      }
    }

    return plan.parentId;
  } catch (error) {
    if (isOfflineOrTokenServiceError(error)) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteHtmlProjectFromFirestore(
  userId: string,
  projectId: string
): Promise<void> {
  const cleanId = sanitizeId(projectId);
  const path = `users/${userId}/htmlProjects/${cleanId}`;
  try {
    const parentRef = doc(db, 'users', userId, 'htmlProjects', cleanId);
    const snap = await getDoc(parentRef);
    if (snap.exists()) {
      const partIds = snap.data()?.editorState?.chunkPartIds;
      if (Array.isArray(partIds)) {
        for (const partId of partIds) {
          if (typeof partId === 'string') {
            await deleteDoc(doc(db, 'users', userId, 'htmlProjects', partId));
          }
        }
      }
    }
    await deleteDoc(parentRef);
  } catch (error) {
    if (isOfflineOrTokenServiceError(error)) {
      return;
    }
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

function timestampToIso(ts: unknown, fallbackIso: string): string {
  if (typeof ts === 'string' && ts) return ts;
  if (
    ts &&
    typeof ts === 'object' &&
    'toDate' in ts &&
    typeof (ts as { toDate: () => Date }).toDate === 'function'
  ) {
    try {
      return (ts as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return fallbackIso;
    }
  }
  return fallbackIso;
}

/**
 * Reassembles single-document and multi-document chunked HTML projects from raw Firestore documents.
 * Filters out internal `--part-N` chunk documents so they never appear as standalone projects.
 */
export function reassembleFirestoreHtmlProjects(
  rawDocs: Array<{ id: string; data: Record<string, any> }>,
  userId: string
): HtmlEditorProject[] {
  const nowIso = new Date().toISOString();
  const docById = new Map<string, Record<string, any>>();
  const parentDocs: Array<{ id: string; data: Record<string, any> }> = [];

  for (const item of rawDocs) {
    docById.set(item.id, item.data);
    const editorState = item.data?.editorState;
    const isChunkPart =
      Boolean(editorState && typeof editorState === 'object' && editorState.isChunkPart === true) ||
      /--part-\d+$/.test(item.id);
    const isGlobalHeaderCssDoc =
      item.id === FIRESTORE_GLOBAL_HEADER_CSS_DOC_ID ||
      item.id.startsWith(`${FIRESTORE_GLOBAL_HEADER_CSS_DOC_ID}--part-`) ||
      Boolean(
        editorState &&
          typeof editorState === 'object' &&
          editorState.isGlobalHeaderCssSetting === true
      );
    if (!isChunkPart && !isGlobalHeaderCssDoc) {
      parentDocs.push(item);
    }
  }

  const results: HtmlEditorProject[] = [];
  for (const { id, data } of parentDocs) {
    const rawState = (data.editorState || {}) as Record<string, any>;
    let currentHtml = String(data.currentHtml || '');
    let originalHtml = String(data.originalHtml ?? data.currentHtml ?? '');
    let customCss: string | undefined =
      typeof data.customCss === 'string'
        ? data.customCss
        : typeof rawState.customCss === 'string'
        ? rawState.customCss
        : undefined;
    let sectionsFromChunks: HtmlProjectSection[] | undefined = undefined;

    if (rawState.isChunkedParent === true && Array.isArray(rawState.chunkPartIds)) {
      const partIds = rawState.chunkPartIds as string[];
      const slices: string[] = [];
      let allPartsPresent = partIds.length > 0;
      for (const partId of partIds) {
        const partDoc = docById.get(partId);
        if (!partDoc || typeof partDoc.currentHtml !== 'string') {
          allPartsPresent = false;
          break;
        }
        slices.push(partDoc.currentHtml);
      }

      if (allPartsPresent) {
        try {
          const parsedEnvelope = JSON.parse(slices.join('')) as ChunkedPayloadEnvelope;
          if (typeof parsedEnvelope.currentHtml === 'string') {
            currentHtml = parsedEnvelope.currentHtml;
          }
          if (typeof parsedEnvelope.originalHtml === 'string') {
            originalHtml = parsedEnvelope.originalHtml;
          }
          if (typeof parsedEnvelope.customCss === 'string') {
            customCss = parsedEnvelope.customCss;
          }
          if (Array.isArray(parsedEnvelope.sections)) {
            sectionsFromChunks = parsedEnvelope.sections;
          }
        } catch {
          // Fall back to parent preview fields if chunk JSON envelope is malformed
        }
      }
    }

    const rawSections = sectionsFromChunks ?? (Array.isArray(rawState.sections) ? rawState.sections : undefined);
    const hydratedSections = Array.isArray(rawSections)
      ? rawSections.map((sec: any) => ({
          ...sec,
          originalHtml:
            typeof sec?.originalHtml === 'string' ? sec.originalHtml : String(sec?.htmlContent || ''),
        }))
      : undefined;

    const normalizedState = normalizeEditorState(rawState, hydratedSections, customCss);
    const updatedAtIso = timestampToIso(data.updatedAt, nowIso);
    results.push(
      ensureProjectHasSections({
        id,
        ownerId: String(data.ownerId || userId),
        name: String(data.name || 'Untitled Project'),
        currentHtml,
        originalHtml,
        baseUrl: String(data.baseUrl || 'https://scienceofgifts.com'),
        customCss: normalizedState.customCss,
        sections: normalizedState.sections,
        editorState: normalizedState,
        createdAt: timestampToIso(data.createdAt, nowIso),
        updatedAt: updatedAtIso,
        syncStatus: 'saved_local_and_cloud',
        pendingCloudSync: false,
        lastCloudSyncedAt: updatedAtIso,
      })
    );
  }

  results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return results;
}

/**
 * Merges incoming Firestore projects with local IndexedDB projects so that:
 * 1. Local-only projects not yet in Firestore are preserved and never hidden.
 * 2. Local projects with `pendingCloudSync === true` or a newer `updatedAt` timestamp
 *    are never overwritten by an older cloud snapshot.
 * 3. Cloud projects not present locally (or newer than synced local copies) are restored locally.
 */
export function mergeCloudAndLocalHtmlProjects(
  cloudProjects: HtmlEditorProject[],
  localProjects: HtmlEditorProject[]
): HtmlEditorProject[] {
  const mergedById = new Map<string, HtmlEditorProject>();

  for (const localProj of localProjects) {
    mergedById.set(localProj.id, localProj);
  }

  for (const cloudProj of cloudProjects) {
    const existingLocal = mergedById.get(cloudProj.id);
    if (!existingLocal) {
      mergedById.set(cloudProj.id, {
        ...cloudProj,
        syncStatus: 'saved_local_and_cloud',
        pendingCloudSync: false,
      });
      continue;
    }

    const localHasPendingChanges = existingLocal.pendingCloudSync === true;
    const localTime = Date.parse(existingLocal.updatedAt || '') || 0;
    const cloudTime = Date.parse(cloudProj.updatedAt || '') || 0;

    if (localHasPendingChanges && localTime >= cloudTime) {
      // Preserve unsynced local changes over stale cloud snapshot
      mergedById.set(cloudProj.id, existingLocal);
    } else if (localTime > cloudTime) {
      mergedById.set(cloudProj.id, existingLocal);
    } else {
      mergedById.set(cloudProj.id, {
        ...cloudProj,
        syncStatus: 'saved_local_and_cloud',
        pendingCloudSync: false,
      });
    }
  }

  return Array.from(mergedById.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function subscribeToHtmlProjects(
  userId: string,
  onData: (projects: HtmlEditorProject[]) => void,
  onError?: (err: Error) => void
) {
  const path = `users/${userId}/htmlProjects`;
  const q = query(
    collection(db, 'users', userId, 'htmlProjects'),
    where('ownerId', '==', userId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const rawDocs = snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, any> }));
      void syncCloudFourthwallHeaderCssFromDocs(rawDocs).catch(() => {
        // Non-blocking cloud Header CSS sync
      });
      const cloudItems = reassembleFirestoreHtmlProjects(rawDocs, userId);
      void hydrateHtmlProjectsFromIdb()
        .then((localItems) => {
          const merged = mergeCloudAndLocalHtmlProjects(cloudItems, localItems);
          if (merged.length > 0) {
            return saveHtmlProjectsBatchToIdb(merged).then(() => merged);
          }
          return merged;
        })
        .then((merged) => {
          onData(merged);
        })
        .catch(() => {
          const fallbackMerged = mergeCloudAndLocalHtmlProjects(
            cloudItems,
            getCachedHtmlProjectsSync()
          );
          onData(fallbackMerged);
        });
    },
    (err) => {
      if (onError) onError(err);
      if (isOfflineOrTokenServiceError(err)) return;
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

/**
 * Validates and persists an HtmlEditorProject to IndexedDB first, then synchronizes with
 * Cloud Firestore when signed in.
 * - If IndexedDB persistence fails, throws a classified `StorageDiagnosticError` so the UI
 *   never falsely displays "Saved".
 * - If IndexedDB succeeds and the user is signed out, sets `syncStatus: 'saved_local_only'`.
 * - If IndexedDB succeeds and Firestore sync succeeds, sets `syncStatus: 'saved_local_and_cloud'`.
 * - If IndexedDB succeeds and Firestore is offline / auth token service is unavailable,
 *   sets `syncStatus: 'saved_local_cloud_pending'` and `pendingCloudSync: true`.
 * - If IndexedDB succeeds and Firestore fails with a permission or size error,
 *   sets `syncStatus: 'saved_local_cloud_failed'`, records `syncDiagnostic`, and throws only
 *   when `options?.throwOnCloudError` is true.
 */
export async function saveHtmlProject(
  project: HtmlEditorProject,
  userId?: string | null,
  options?: {
    firestoreWriter?: (uid: string, proj: HtmlEditorProject) => Promise<string>;
    throwOnCloudError?: boolean;
  }
): Promise<HtmlEditorProject> {
  const cleanId = sanitizeId(project.id);
  const cleanName = (project.name || '').trim();
  const hydrated = ensureProjectHasSections({
    ...project,
    id: cleanId,
    name: cleanName,
  });
  const validation = validateHtmlProjectForSave({
    ...hydrated,
    id: cleanId,
    name: cleanName,
  });
  if (!validation.valid) {
    throw new StorageDiagnosticError(
      'validation_error',
      validation.error || 'Invalid project data.'
    );
  }

  const nowIso = new Date().toISOString();
  const existingList = getCachedHtmlProjectsSync();
  const existingRecord = existingList.find((p) => p.id === cleanId);
  const normalizedEditorState = normalizeEditorState(
    hydrated.editorState,
    hydrated.sections,
    hydrated.customCss ?? hydrated.editorState?.customCss
  );

  const initialRecord: HtmlEditorProject = {
    id: cleanId,
    ownerId: userId || hydrated.ownerId || 'local-preview',
    name: cleanName,
    currentHtml: hydrated.currentHtml,
    originalHtml: hydrated.originalHtml,
    baseUrl: (hydrated.baseUrl || 'https://scienceofgifts.com').trim(),
    customCss: normalizedEditorState.customCss,
    sections: normalizedEditorState.sections,
    editorState: normalizedEditorState,
    createdAt: existingRecord?.createdAt || hydrated.createdAt || nowIso,
    updatedAt: nowIso,
    syncStatus: userId ? 'saved_local_cloud_pending' : 'saved_local_only',
    pendingCloudSync: Boolean(userId),
    syncDiagnostic: undefined,
    lastCloudSyncedAt: existingRecord?.lastCloudSyncedAt || hydrated.lastCloudSyncedAt,
  };

  try {
    await saveHtmlProjectToIdb(initialRecord);
  } catch (err) {
    throw classifyStorageFailure(err, 'idb');
  }

  if (!userId) {
    return initialRecord;
  }

  const writer = options?.firestoreWriter || saveHtmlProjectToFirestore;
  try {
    await writer(userId, initialRecord);
    const syncedRecord: HtmlEditorProject = {
      ...initialRecord,
      syncStatus: 'saved_local_and_cloud',
      pendingCloudSync: false,
      syncDiagnostic: undefined,
      lastCloudSyncedAt: new Date().toISOString(),
    };
    try {
      await saveHtmlProjectToIdb(syncedRecord);
    } catch {
      // Initial IndexedDB write already succeeded and verified
    }
    return syncedRecord;
  } catch (cloudErr) {
    if (isOfflineOrTokenServiceError(cloudErr)) {
      const pendingRecord: HtmlEditorProject = {
        ...initialRecord,
        syncStatus: 'saved_local_cloud_pending',
        pendingCloudSync: true,
        syncDiagnostic:
          'Saved locally in IndexedDB. Cloud sync is pending because Firestore is offline or auth token service is unavailable.',
      };
      try {
        await saveHtmlProjectToIdb(pendingRecord);
      } catch {
        // Keep local save intact
      }
      if (options?.throwOnCloudError) {
        throw classifyStorageFailure(cloudErr, 'firestore');
      }
      return pendingRecord;
    }

    const classifiedCloudError = classifyStorageFailure(cloudErr, 'firestore');
    const cloudFailedRecord: HtmlEditorProject = {
      ...initialRecord,
      syncStatus: 'saved_local_cloud_failed',
      pendingCloudSync: true,
      syncDiagnostic: classifiedCloudError.message,
    };
    try {
      await saveHtmlProjectToIdb(cloudFailedRecord);
    } catch {
      // Keep local save intact
    }
    if (options?.throwOnCloudError) {
      throw classifiedCloudError;
    }
    return cloudFailedRecord;
  }
}

/**
 * Creates a brand-new HTML Editor project and persists it immediately.
 */
export async function createNewHtmlProject(
  params: {
    name: string;
    initialHtml?: string;
    htmlContent?: string;
    baseUrl?: string;
    customCss?: string;
    userId?: string | null;
    sections?: HtmlProjectSection[];
    editorState?: Partial<HtmlProjectEditorState>;
  },
  userIdArg?: string | null
): Promise<HtmlEditorProject> {
  const effectiveUserId = userIdArg !== undefined ? userIdArg : params.userId;
  const html = params.initialHtml ?? params.htmlContent ?? '';
  const nowIso = new Date().toISOString();
  const newId = sanitizeId(
    `proj-${params.name.toLowerCase().slice(0, 32)}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 5)}`
  );
  const normalizedState = normalizeEditorState(
    params.editorState,
    params.sections,
    params.customCss ?? params.editorState?.customCss
  );
  const baseProject: HtmlEditorProject = ensureProjectHasSections({
    id: newId,
    ownerId: effectiveUserId || 'local-preview',
    name: (params.name || 'Untitled Gift Guide').trim(),
    currentHtml: html,
    originalHtml: html,
    baseUrl: (params.baseUrl || 'https://scienceofgifts.com').trim(),
    customCss: normalizedState.customCss,
    sections: params.sections,
    editorState: normalizedState,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  return saveHtmlProject(baseProject, effectiveUserId);
}

/**
 * Renames an existing HTML Editor project without altering its HTML content.
 */
export async function renameHtmlProject(
  projectId: string,
  newName: string,
  userId?: string | null
): Promise<HtmlEditorProject> {
  const cleanName = (newName || '').trim();
  if (!cleanName) {
    throw new Error('Project name cannot be empty.');
  }
  const list = await hydrateHtmlProjectsFromIdb();
  const target = list.find((p) => p.id === projectId);
  if (!target) {
    throw new Error(`Project "${projectId}" not found.`);
  }
  return saveHtmlProject(
    {
      ...target,
      name: cleanName,
    },
    userId
  );
}

/**
 * Duplicates an existing HTML Editor project into an independent project with its own ID.
 */
export async function duplicateHtmlProject(
  sourceProjectId: string,
  customName?: string | null,
  userId?: string | null
): Promise<HtmlEditorProject> {
  const list = await hydrateHtmlProjectsFromIdb();
  const source = list.find((p) => p.id === sourceProjectId);
  if (!source) {
    throw new Error(`Source project "${sourceProjectId}" not found.`);
  }
  const nowIso = new Date().toISOString();
  const copyName = (customName || `${source.name} (Copy)`).trim();
  const newId = sanitizeId(
    `${source.id}-copy-${Date.now().toString(36).slice(-4)}-${Math.random()
      .toString(36)
      .slice(2, 5)}`
  );
  const clonedSections = (source.sections || source.editorState?.sections)?.map((sec) => ({
    ...sec,
  }));
  const duplicated: HtmlEditorProject = {
    ...source,
    id: newId,
    ownerId: userId || source.ownerId || 'local-preview',
    name: copyName,
    sections: clonedSections,
    editorState: {
      ...source.editorState,
      ...(clonedSections ? { sections: clonedSections } : {}),
    },
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  return saveHtmlProject(duplicated, userId);
}

/**
 * Deletes an HTML Editor project permanently from IndexedDB and Cloud Firestore.
 */
export async function deleteHtmlProject(
  projectId: string,
  userId?: string | null
): Promise<HtmlEditorProject[]> {
  const remaining = await removeHtmlProjectFromIdb(projectId);

  if (userId) {
    await deleteHtmlProjectFromFirestore(userId, projectId);
  }
  return remaining;
}

// ============================================================================
// PERSISTENT GLOBAL FOURTHWALL HEADER CSS (LIVE PREVIEW REFERENCE)
// ============================================================================

export function getFourthwallHeaderCssSync(): FourthwallHeaderCssSetting {
  return getCachedFourthwallHeaderCssSync();
}

export async function loadFourthwallHeaderCssAsync(): Promise<FourthwallHeaderCssSetting> {
  return hydrateFourthwallHeaderCssFromIdb();
}

function buildHeaderCssCloudMirrorProject(
  userId: string,
  setting: FourthwallHeaderCssSetting
): HtmlEditorProject {
  const nowIso = setting.updatedAt || new Date().toISOString();
  return {
    id: FIRESTORE_GLOBAL_HEADER_CSS_DOC_ID,
    ownerId: userId,
    name: 'Fourthwall Header CSS (Live Preview Reference)',
    currentHtml: setting.currentCss,
    originalHtml: setting.previousCss || '',
    baseUrl: 'https://scienceofgifts.com',
    customCss: setting.currentCss,
    editorState: {
      viewMode: 'css',
      selectedBlockId: 'ALL',
      previewViewport: 'desktop',
      includeFourthwallCss: true,
      customCss: setting.currentCss,
      isGlobalHeaderCssSetting: true,
    } as HtmlProjectEditorState & { isGlobalHeaderCssSetting: boolean },
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export async function syncCloudFourthwallHeaderCssFromDocs(
  rawDocs: Array<{ id: string; data: Record<string, any> }>
): Promise<FourthwallHeaderCssSetting | null> {
  const parentDoc = rawDocs.find(
    (d) =>
      d.id === FIRESTORE_GLOBAL_HEADER_CSS_DOC_ID ||
      d.data?.editorState?.isGlobalHeaderCssSetting === true
  );
  if (!parentDoc) return null;

  const docById = new Map<string, Record<string, any>>();
  for (const d of rawDocs) {
    docById.set(d.id, d.data);
  }

  const rawState = (parentDoc.data.editorState || {}) as Record<string, any>;
  let currentCss = String(parentDoc.data.currentHtml || '');
  let previousCss: string | null =
    typeof parentDoc.data.originalHtml === 'string' && parentDoc.data.originalHtml.trim()
      ? parentDoc.data.originalHtml
      : null;

  if (rawState.isChunkedParent === true && Array.isArray(rawState.chunkPartIds)) {
    const slices: string[] = [];
    let allPresent = rawState.chunkPartIds.length > 0;
    for (const partId of rawState.chunkPartIds) {
      const partDoc = docById.get(String(partId));
      if (!partDoc || typeof partDoc.currentHtml !== 'string') {
        allPresent = false;
        break;
      }
      slices.push(partDoc.currentHtml);
    }
    if (allPresent) {
      try {
        const parsed = JSON.parse(slices.join('')) as ChunkedPayloadEnvelope;
        if (typeof parsed.currentHtml === 'string' && parsed.currentHtml.trim()) {
          currentCss = parsed.currentHtml;
        }
        if (typeof parsed.originalHtml === 'string') {
          previousCss = parsed.originalHtml.trim() ? parsed.originalHtml : null;
        }
      } catch {
        // Keep parent preview fields if chunk envelope is malformed
      }
    }
  }

  if (!currentCss.trim()) return null;

  const cloudUpdatedAt = timestampToIso(parentDoc.data.updatedAt, new Date().toISOString());
  const localSetting = await hydrateFourthwallHeaderCssFromIdb();
  const localTime = Date.parse(localSetting.updatedAt || '') || 0;
  const cloudTime = Date.parse(cloudUpdatedAt || '') || 0;

  // Never overwrite newer local Header CSS during cloud sync
  if (localSetting.isCustomized && localTime >= cloudTime) {
    return localSetting;
  }

  return saveFourthwallHeaderCssToIdb(currentCss, {
    preservePreviousOverride: previousCss,
    updatedAt: cloudUpdatedAt,
    syncStatus: 'saved_local_and_cloud',
  });
}

/**
 * Saves an updated Fourthwall Header CSS stylesheet persistently in IndexedDB (and Cloud Firestore when signed in).
 * Automatically preserves the previous saved version so it can be restored if needed.
 */
export async function saveFourthwallHeaderCss(
  nextCssInput: string,
  userId?: string | null,
  options?: {
    firestoreWriter?: (uid: string, proj: HtmlEditorProject) => Promise<string>;
    throwOnCloudError?: boolean;
  }
): Promise<FourthwallHeaderCssSetting> {
  const savedLocal = await saveFourthwallHeaderCssToIdb(nextCssInput, {
    syncStatus: userId ? 'saved_local_cloud_pending' : 'saved_local_only',
  });

  if (!userId) {
    return savedLocal;
  }

  const writer = options?.firestoreWriter || saveHtmlProjectToFirestore;
  const cloudMirror = buildHeaderCssCloudMirrorProject(userId, savedLocal);

  try {
    await writer(userId, cloudMirror);
    return await saveFourthwallHeaderCssToIdb(savedLocal.currentCss, {
      preservePreviousOverride: savedLocal.previousCss,
      updatedAt: savedLocal.updatedAt,
      syncStatus: 'saved_local_and_cloud',
    });
  } catch (cloudErr) {
    if (isOfflineOrTokenServiceError(cloudErr)) {
      const pending = await saveFourthwallHeaderCssToIdb(savedLocal.currentCss, {
        preservePreviousOverride: savedLocal.previousCss,
        updatedAt: savedLocal.updatedAt,
        syncStatus: 'saved_local_cloud_pending',
        syncDiagnostic:
          'Saved locally in IndexedDB. Cloud sync is pending because Firestore is offline or auth token service is unavailable.',
      });
      if (options?.throwOnCloudError) {
        throw classifyStorageFailure(cloudErr, 'firestore');
      }
      return pending;
    }

    const classified = classifyStorageFailure(cloudErr, 'firestore');
    const failedCloud = await saveFourthwallHeaderCssToIdb(savedLocal.currentCss, {
      preservePreviousOverride: savedLocal.previousCss,
      updatedAt: savedLocal.updatedAt,
      syncStatus: 'saved_local_cloud_failed',
      syncDiagnostic: classified.message,
    });
    if (options?.throwOnCloudError) {
      throw classified;
    }
    return failedCloud;
  }
}

/**
 * Restores the previous saved version of the Fourthwall Header CSS in IndexedDB (and Cloud Firestore when signed in).
 */
export async function restorePreviousFourthwallHeaderCss(
  userId?: string | null,
  options?: {
    firestoreWriter?: (uid: string, proj: HtmlEditorProject) => Promise<string>;
    throwOnCloudError?: boolean;
  }
): Promise<FourthwallHeaderCssSetting> {
  const restoredLocal = await restorePreviousFourthwallHeaderCssInIdb();
  if (!userId) {
    return restoredLocal;
  }

  const writer = options?.firestoreWriter || saveHtmlProjectToFirestore;
  const cloudMirror = buildHeaderCssCloudMirrorProject(userId, restoredLocal);

  try {
    await writer(userId, cloudMirror);
    return await saveFourthwallHeaderCssToIdb(restoredLocal.currentCss, {
      preservePreviousOverride: restoredLocal.previousCss,
      updatedAt: restoredLocal.updatedAt,
      syncStatus: 'saved_local_and_cloud',
    });
  } catch (cloudErr) {
    if (options?.throwOnCloudError) {
      throw classifyStorageFailure(cloudErr, 'firestore');
    }
    return restoredLocal;
  }
}


