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
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
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
import { ensureProjectHasSections } from './htmlWorkspaceEngine';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
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
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection to Firestore on boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

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
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data() as UserSettings;
    }
    const payload = {
      ownerId: user.uid,
      displayName: (user.displayName || user.email || 'Editor').slice(0, 120),
      defaultStoreBaseUrl: 'https://scienceofgifts.com',
      schemaVersion: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, payload);
    return payload;
  } catch (error) {
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

  return {
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
  };
}

const LOCAL_PRODUCTS_STORAGE_KEY = 'sog_catalog_products_v2';

export function loadLocalCatalogProducts(): Product[] | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_PRODUCTS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Product[]) : null;
  } catch {
    return null;
  }
}

export function saveLocalCatalogProducts(products: Product[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(LOCAL_PRODUCTS_STORAGE_KEY, JSON.stringify(products));
  } catch {
    // Ignore storage quota errors
  }
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
    handleFirestoreError(error, isExisting ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function deleteProductFromFirestore(userId: string, productId: string): Promise<void> {
  const path = `users/${userId}/products/${productId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'products', productId));
  } catch (error) {
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
// PERSISTENT HTML EDITOR PROJECTS (LOCAL STORAGE + CLOUD FIRESTORE)
// ============================================================================

export const LOCAL_HTML_PROJECTS_STORAGE_KEY = 'sog_html_projects_v1';
export const LOCAL_ACTIVE_HTML_PROJECT_ID_KEY = 'sog_html_active_project_id_v1';
export const MAX_SINGLE_HTML_FIELD_CHARS = 400_000;
export const MAX_TOTAL_LOCAL_STORAGE_CHARS = 4_200_000;

export const DEFAULT_HTML_EDITOR_STATE: HtmlProjectEditorState = {
  viewMode: 'split',
  selectedBlockId: 'ALL',
  previewViewport: 'desktop',
  includeFourthwallCss: true,
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
  if (project.currentHtml.length > MAX_SINGLE_HTML_FIELD_CHARS) {
    return {
      valid: false,
      error: `Edited HTML size (${Math.round(project.currentHtml.length / 1024)} KB) exceeds the safe 400 KB per-project storage limit.`,
    };
  }
  if (typeof project.originalHtml !== 'string') {
    return { valid: false, error: 'Original HTML content must be a string.' };
  }
  if (project.originalHtml.length > MAX_SINGLE_HTML_FIELD_CHARS) {
    return {
      valid: false,
      error: `Original HTML size (${Math.round(project.originalHtml.length / 1024)} KB) exceeds the safe 400 KB per-project storage limit.`,
    };
  }
  if ((project.baseUrl || '').length > 1000) {
    return { valid: false, error: 'Base URL exceeds maximum length (1000 characters).' };
  }
  return { valid: true };
}

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

function sanitizeProjectSections(rawSections?: unknown): HtmlProjectSection[] | undefined {
  if (!Array.isArray(rawSections)) return undefined;
  const nowIso = new Date().toISOString();
  const result: HtmlProjectSection[] = [];
  for (let i = 0; i < Math.min(rawSections.length, 150); i++) {
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

    const sectionRecord: HtmlProjectSection = {
      id: cleanId,
      name: cleanName,
      order: i,
      htmlContent: rec.htmlContent.slice(0, MAX_SINGLE_HTML_FIELD_CHARS),
      originalHtml:
        typeof rec.originalHtml === 'string'
          ? rec.originalHtml.slice(0, MAX_SINGLE_HTML_FIELD_CHARS)
          : rec.htmlContent.slice(0, MAX_SINGLE_HTML_FIELD_CHARS),
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

function normalizeEditorState(
  raw?: Partial<HtmlProjectEditorState>,
  fallbackSections?: HtmlProjectSection[]
): HtmlProjectEditorState {
  const sanitizedStartingNumbers: Record<string, number> = {};
  if (raw?.sectionStartingNumbers && typeof raw.sectionStartingNumbers === 'object') {
    const entries = Object.entries(raw.sectionStartingNumbers).slice(0, 100);
    for (const [key, val] of entries) {
      if (typeof key === 'string' && key.trim() && typeof val === 'number' && Number.isInteger(val) && val >= 1) {
        sanitizedStartingNumbers[key.trim().slice(0, 160)] = val;
      }
    }
  }

  const sanitizedSections = sanitizeProjectSections(raw?.sections ?? fallbackSections);

  return {
    viewMode:
      raw?.viewMode === 'split' ||
      raw?.viewMode === 'visual' ||
      raw?.viewMode === 'raw' ||
      raw?.viewMode === 'preview'
        ? raw.viewMode
        : 'split',
    selectedBlockId: typeof raw?.selectedBlockId === 'string' && raw.selectedBlockId ? raw.selectedBlockId : 'ALL',
    sidebarTab: raw?.sidebarTab === 'anchors' ? 'anchors' : 'blocks',
    previewViewport: raw?.previewViewport === 'mobile' ? 'mobile' : 'desktop',
    includeFourthwallCss: raw?.includeFourthwallCss !== false,
    ...(Object.keys(sanitizedStartingNumbers).length > 0
      ? { sectionStartingNumbers: sanitizedStartingNumbers }
      : {}),
    ...(sanitizedSections !== undefined ? { sections: sanitizedSections } : {}),
  };
}

export function loadLocalHtmlProjects(): HtmlEditorProject[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_HTML_PROJECTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter(
            (item) =>
              item &&
              typeof item === 'object' &&
              typeof item.id === 'string' &&
              typeof item.name === 'string' &&
              typeof item.currentHtml === 'string'
          )
          .map((item) => {
            const normalizedEditorState = normalizeEditorState(item.editorState, item.sections);
            return ensureProjectHasSections({
              id: item.id,
              ownerId: typeof item.ownerId === 'string' ? item.ownerId : 'local-preview',
              name: item.name,
              currentHtml: item.currentHtml,
              originalHtml:
                typeof item.originalHtml === 'string' ? item.originalHtml : item.currentHtml,
              baseUrl:
                typeof item.baseUrl === 'string' ? item.baseUrl : 'https://scienceofgifts.com',
              sections: normalizedEditorState.sections,
              editorState: normalizedEditorState,
              createdAt:
                typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
              updatedAt:
                typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
            });
          })
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      }
    }

    // Migrate legacy single-session HTML if present
    const legacySessionRaw = window.localStorage.getItem('sog_html_workspace_session_v2');
    const legacyCurrent = window.localStorage.getItem('sog_html_workspace_v2_current');
    const legacyOriginal = window.localStorage.getItem('sog_html_workspace_v2_original');

    let migratedCurrent = '';
    let migratedOriginal = '';
    if (legacyCurrent && legacyCurrent.trim()) {
      migratedCurrent = legacyCurrent;
      migratedOriginal = legacyOriginal && legacyOriginal.trim() ? legacyOriginal : legacyCurrent;
    } else if (legacySessionRaw) {
      const parsedSession = JSON.parse(legacySessionRaw);
      if (typeof parsedSession?.currentHtml === 'string' && parsedSession.currentHtml.trim()) {
        migratedCurrent = parsedSession.currentHtml;
        migratedOriginal =
          typeof parsedSession?.originalHtml === 'string' && parsedSession.originalHtml.trim()
            ? parsedSession.originalHtml
            : parsedSession.currentHtml;
      }
    }

    if (migratedCurrent) {
      const nowIso = new Date().toISOString();
      const migratedProject = ensureProjectHasSections({
        id: 'proj-greek-mythology-default',
        ownerId: 'local-preview',
        name: 'Greek Mythology Gift Guide',
        currentHtml: migratedCurrent,
        originalHtml: migratedOriginal,
        baseUrl: 'https://scienceofgifts.com',
        editorState: { ...DEFAULT_HTML_EDITOR_STATE },
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      saveLocalHtmlProjectsList([migratedProject]);
      setActiveLocalHtmlProjectId(migratedProject.id);
      return [migratedProject];
    }
  } catch {
    return [];
  }
  return [];
}

export function getActiveLocalHtmlProjectId(): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    return window.localStorage.getItem(LOCAL_ACTIVE_HTML_PROJECT_ID_KEY);
  } catch {
    return null;
  }
}

export function setActiveLocalHtmlProjectId(projectId: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(LOCAL_ACTIVE_HTML_PROJECT_ID_KEY, projectId);
  } catch {
    // Ignore active ID pointer failure if storage is locked
  }
}

/**
 * Writes the complete list of HTML projects to localStorage with strict size and error checks.
 * Never swallows errors silently—throws an actionable Error if quota is exceeded or storage fails.
 */
export function saveLocalHtmlProjectsList(projects: HtmlEditorProject[]): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    throw new Error('Browser localStorage is unavailable in this environment.');
  }
  const serialized = JSON.stringify(projects);
  if (serialized.length > MAX_TOTAL_LOCAL_STORAGE_CHARS) {
    throw new Error(
      `Total project storage (${Math.round(serialized.length / 1024)} KB) exceeds safe browser storage capacity (~4.1 MB). Delete unused projects before saving.`
    );
  }
  try {
    window.localStorage.setItem(LOCAL_HTML_PROJECTS_STORAGE_KEY, serialized);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to persist project to browser storage: ${msg}`);
  }
}

function sanitizeHtmlProjectFirestorePayload(userId: string, project: HtmlEditorProject) {
  return {
    ownerId: userId,
    name: (project.name || 'Untitled Project').trim().slice(0, 300),
    currentHtml: (project.currentHtml || '').slice(0, MAX_SINGLE_HTML_FIELD_CHARS),
    originalHtml: (project.originalHtml || '').slice(0, MAX_SINGLE_HTML_FIELD_CHARS),
    baseUrl: (project.baseUrl || 'https://scienceofgifts.com').trim().slice(0, 1000),
    editorState: normalizeEditorState(project.editorState, project.sections),
  };
}

export async function saveHtmlProjectToFirestore(
  userId: string,
  project: HtmlEditorProject
): Promise<string> {
  const cleanId = sanitizeId(project.id);
  const path = `users/${userId}/htmlProjects/${cleanId}`;
  const ref = doc(db, 'users', userId, 'htmlProjects', cleanId);
  const base = sanitizeHtmlProjectFirestorePayload(userId, { ...project, id: cleanId });

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const { ownerId: _o, ...mutableFields } = base;
      await updateDoc(ref, {
        ...mutableFields,
        updatedAt: serverTimestamp(),
      });
      return cleanId;
    }
    await setDoc(ref, {
      ...base,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return cleanId;
  } catch (error) {
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
    await deleteDoc(doc(db, 'users', userId, 'htmlProjects', cleanId));
  } catch (error) {
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
      const nowIso = new Date().toISOString();
      const cloudItems: HtmlEditorProject[] = snap.docs.map((d) => {
        const data = d.data();
        const normalizedState = normalizeEditorState(data.editorState);
        return ensureProjectHasSections({
          id: d.id,
          ownerId: String(data.ownerId || userId),
          name: String(data.name || 'Untitled Project'),
          currentHtml: String(data.currentHtml || ''),
          originalHtml: String(data.originalHtml ?? data.currentHtml ?? ''),
          baseUrl: String(data.baseUrl || 'https://scienceofgifts.com'),
          sections: normalizedState.sections,
          editorState: normalizedState,
          createdAt: timestampToIso(data.createdAt, nowIso),
          updatedAt: timestampToIso(data.updatedAt, nowIso),
        });
      });
      cloudItems.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      if (cloudItems.length > 0) {
        try {
          saveLocalHtmlProjectsList(cloudItems);
        } catch {
          // Ignore local mirror quota error on cloud subscription
        }
      }
      onData(cloudItems);
    },
    (err) => {
      if (onError) onError(err);
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

/**
 * Validates and persists an HtmlEditorProject to local storage (and Cloud Firestore when signed in).
 * Throws an explicit Error if validation or storage fails so the UI never falsely displays "Saved".
 */
export async function saveHtmlProject(
  project: HtmlEditorProject,
  userId?: string | null
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
    throw new Error(validation.error || 'Invalid project data.');
  }

  const nowIso = new Date().toISOString();
  const existingList = loadLocalHtmlProjects();
  const existingRecord = existingList.find((p) => p.id === cleanId);
  const normalizedEditorState = normalizeEditorState(hydrated.editorState, hydrated.sections);

  const savedRecord: HtmlEditorProject = {
    id: cleanId,
    ownerId: userId || hydrated.ownerId || 'local-preview',
    name: cleanName,
    currentHtml: hydrated.currentHtml,
    originalHtml: hydrated.originalHtml,
    baseUrl: (hydrated.baseUrl || 'https://scienceofgifts.com').trim(),
    sections: normalizedEditorState.sections,
    editorState: normalizedEditorState,
    createdAt: existingRecord?.createdAt || hydrated.createdAt || nowIso,
    updatedAt: nowIso,
  };

  const nextList = existingRecord
    ? existingList.map((p) => (p.id === cleanId ? savedRecord : p))
    : [savedRecord, ...existingList];

  nextList.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  saveLocalHtmlProjectsList(nextList);
  setActiveLocalHtmlProjectId(savedRecord.id);

  if (userId) {
    await saveHtmlProjectToFirestore(userId, savedRecord);
  }

  return savedRecord;
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
    `proj-${params.name.toLowerCase().slice(0, 32)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`
  );
  const baseProject: HtmlEditorProject = ensureProjectHasSections({
    id: newId,
    ownerId: effectiveUserId || 'local-preview',
    name: (params.name || 'Untitled Gift Guide').trim(),
    currentHtml: html,
    originalHtml: html,
    baseUrl: (params.baseUrl || 'https://scienceofgifts.com').trim(),
    sections: params.sections,
    editorState: normalizeEditorState(params.editorState, params.sections),
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
  const list = loadLocalHtmlProjects();
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
  const list = loadLocalHtmlProjects();
  const source = list.find((p) => p.id === sourceProjectId);
  if (!source) {
    throw new Error(`Source project "${sourceProjectId}" not found.`);
  }
  const nowIso = new Date().toISOString();
  const copyName = (customName || `${source.name} (Copy)`).trim();
  const newId = sanitizeId(
    `${source.id}-copy-${Date.now().toString(36).slice(-4)}-${Math.random().toString(36).slice(2, 5)}`
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
 * Deletes an HTML Editor project permanently from local storage and Cloud Firestore.
 */
export async function deleteHtmlProject(
  projectId: string,
  userId?: string | null
): Promise<HtmlEditorProject[]> {
  const list = loadLocalHtmlProjects();
  const remaining = list.filter((p) => p.id !== projectId);
  saveLocalHtmlProjectsList(remaining);

  const activeId = getActiveLocalHtmlProjectId();
  if (activeId === projectId) {
    setActiveLocalHtmlProjectId(remaining[0]?.id || '');
  }

  if (userId) {
    await deleteHtmlProjectFromFirestore(userId, projectId);
  }
  return remaining;
}

