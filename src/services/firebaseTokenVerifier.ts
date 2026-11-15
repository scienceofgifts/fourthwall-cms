import firebaseConfig from '../../firebase-applet-config.json';

export const GOOGLE_SECURETOKEN_JWK_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export const DEFAULT_FIREBASE_PROJECT_ID =
  firebaseConfig.projectId || 'rock-sound-kdtd0';

/**
 * Default authorized Science of Gifts CMS accounts (emails and UIDs).
 * Additional accounts can be configured via `CMS_AUTHORIZED_EMAILS` and `CMS_AUTHORIZED_UIDS`
 * server/Worker environment variables.
 */
export const DEFAULT_AUTHORIZED_CMS_EMAILS: readonly string[] = [
  'scienceofgifts@gmail.com',
  'dattarajpai.k@gmail.com',
];

export const DEFAULT_AUTHORIZED_CMS_UIDS: readonly string[] = [
  'kXSNJQbhD7fxP64zJgGY5ALlZ1c2',
];

export interface FirebaseAuthEnvironmentConfig {
  FIREBASE_PROJECT_ID?: string;
  CMS_AUTHORIZED_EMAILS?: string;
  CMS_AUTHORIZED_UIDS?: string;
}

export interface GoogleJwkKey extends JsonWebKey {
  kid: string;
  kty: string;
  alg?: string;
  use?: string;
  n: string;
  e: string;
}

export interface GoogleJwkSet {
  keys: GoogleJwkKey[];
}

export interface FirebaseIdTokenHeader {
  alg: string;
  kid: string;
  typ?: string;
}

export interface FirebaseIdTokenPayload {
  iss: string;
  aud: string;
  sub: string;
  user_id?: string;
  email?: string;
  email_verified?: boolean;
  iat: number;
  exp: number;
  auth_time?: number;
}

export interface FirebaseTokenVerificationOptions {
  customFetch?: typeof fetch;
  customJwkSet?: GoogleJwkSet;
  nowSeconds?: number;
}

export type FirebaseTokenVerificationResult =
  | {
      ok: true;
      status: 200;
      uid: string;
      email: string;
      projectId: string;
      claims: FirebaseIdTokenPayload;
    }
  | {
      ok: false;
      status: 401 | 403;
      error: string;
    };

interface CachedJwkState {
  jwkSet: GoogleJwkSet;
  expiresAtMs: number;
}

let cachedGoogleJwks: CachedJwkState | null = null;

export function clearCachedGoogleJwksForTesting(): void {
  cachedGoogleJwks = null;
}

function decodeBase64UrlToBytes(base64Url: string): Uint8Array {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');

  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(padded, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function decodeBase64UrlToJson<T>(base64Url: string): T {
  const bytes = decodeBase64UrlToBytes(base64Url);
  const text = new TextDecoder('utf-8').decode(bytes);
  return JSON.parse(text) as T;
}

function toCleanArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function parseMaxAgeSeconds(cacheControl: string | null): number {
  if (!cacheControl) return 3600;
  const match = cacheControl.match(/max-age=(\d+)/i);
  if (!match) return 3600;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3600;
}

async function fetchGooglePublicJwkSet(
  options?: FirebaseTokenVerificationOptions,
  forceRefresh = false
): Promise<GoogleJwkSet> {
  if (options?.customJwkSet) {
    return options.customJwkSet;
  }

  const nowMs = Date.now();
  if (!forceRefresh && cachedGoogleJwks && cachedGoogleJwks.expiresAtMs > nowMs) {
    return cachedGoogleJwks.jwkSet;
  }

  const fetchFn = options?.customFetch || fetch;
  const response = await fetchFn(GOOGLE_SECURETOKEN_JWK_URL, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Google Firebase public JWK keys (HTTP ${response.status}).`
    );
  }

  const data = (await response.json()) as GoogleJwkSet;
  if (!data || !Array.isArray(data.keys) || data.keys.length === 0) {
    throw new Error('Google Firebase JWK endpoint returned an empty or invalid keyset.');
  }

  const maxAgeSec = parseMaxAgeSeconds(response.headers.get('cache-control'));
  cachedGoogleJwks = {
    jwkSet: data,
    expiresAtMs: nowMs + maxAgeSec * 1000,
  };

  return data;
}

export function resolveAuthorizedCmsAllowlist(env: FirebaseAuthEnvironmentConfig = {}): {
  emails: Set<string>;
  uids: Set<string>;
} {
  const emails = new Set<string>(
    DEFAULT_AUTHORIZED_CMS_EMAILS.map((e) => e.trim().toLowerCase()).filter(Boolean)
  );
  const uids = new Set<string>(
    DEFAULT_AUTHORIZED_CMS_UIDS.map((u) => u.trim()).filter(Boolean)
  );

  if (typeof env.CMS_AUTHORIZED_EMAILS === 'string' && env.CMS_AUTHORIZED_EMAILS.trim()) {
    for (const part of env.CMS_AUTHORIZED_EMAILS.split(',')) {
      const normalized = part.trim().toLowerCase();
      if (normalized) emails.add(normalized);
    }
  }

  if (typeof env.CMS_AUTHORIZED_UIDS === 'string' && env.CMS_AUTHORIZED_UIDS.trim()) {
    for (const part of env.CMS_AUTHORIZED_UIDS.split(',')) {
      const normalized = part.trim();
      if (normalized) uids.add(normalized);
    }
  }

  return { emails, uids };
}

/**
 * Verifies a Firebase Authentication ID token (RS256 JWT) on the server / Cloudflare Worker
 * and checks that the authenticated user is an explicitly authorized Science of Gifts CMS user.
 */
export async function verifyFirebaseIdTokenForR2Upload(
  authHeader: string | null | undefined,
  env: FirebaseAuthEnvironmentConfig = {},
  options?: FirebaseTokenVerificationOptions
): Promise<FirebaseTokenVerificationResult> {
  const rawHeader = (authHeader || '').trim();
  if (!rawHeader || !/^Bearer\s+/i.test(rawHeader)) {
    return {
      ok: false,
      status: 401,
      error:
        'Unauthorized R2 upload request: missing Firebase Authentication Bearer token. Sign in with Google in the CMS before uploading to R2.',
    };
  }

  const token = rawHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: 'Unauthorized R2 upload request: Bearer token is empty.',
    };
  }

  const segments = token.split('.');
  if (segments.length !== 3 || !segments[0] || !segments[1] || !segments[2]) {
    return {
      ok: false,
      status: 401,
      error:
        'Unauthorized R2 upload request: malformed Firebase ID token (expected a 3-part RS256 JWT).',
    };
  }

  const [headerB64, payloadB64, signatureB64] = segments;

  let header: FirebaseIdTokenHeader;
  let payload: FirebaseIdTokenPayload;
  let signatureBytes: Uint8Array;

  try {
    header = decodeBase64UrlToJson<FirebaseIdTokenHeader>(headerB64);
    payload = decodeBase64UrlToJson<FirebaseIdTokenPayload>(payloadB64);
    signatureBytes = decodeBase64UrlToBytes(signatureB64);
  } catch {
    return {
      ok: false,
      status: 401,
      error: 'Unauthorized R2 upload request: unable to decode Firebase ID token segments.',
    };
  }

  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid.trim()) {
    return {
      ok: false,
      status: 401,
      error:
        'Unauthorized R2 upload request: invalid token header (expected alg="RS256" and non-empty kid).',
    };
  }

  const expectedProjectId = (
    env.FIREBASE_PROJECT_ID ||
    DEFAULT_FIREBASE_PROJECT_ID
  ).trim();
  const expectedIssuer = `https://securetoken.google.com/${expectedProjectId}`;
  const nowSeconds = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
  const clockSkewSeconds = 30;

  if (payload.aud !== expectedProjectId) {
    return {
      ok: false,
      status: 401,
      error: `Unauthorized R2 upload request: token audience (${String(
        payload.aud || 'missing'
      )}) does not match Firebase project "${expectedProjectId}".`,
    };
  }

  if (payload.iss !== expectedIssuer) {
    return {
      ok: false,
      status: 401,
      error: `Unauthorized R2 upload request: token issuer (${String(
        payload.iss || 'missing'
      )}) does not match "${expectedIssuer}".`,
    };
  }

  if (
    typeof payload.sub !== 'string' ||
    payload.sub.trim().length === 0 ||
    payload.sub.length > 128
  ) {
    return {
      ok: false,
      status: 401,
      error: 'Unauthorized R2 upload request: token subject (sub / UID) is missing or invalid.',
    };
  }

  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds - clockSkewSeconds) {
    return {
      ok: false,
      status: 401,
      error:
        'Unauthorized R2 upload request: Firebase ID token has expired. Refresh your session or sign in again.',
    };
  }

  if (typeof payload.iat !== 'number' || payload.iat > nowSeconds + clockSkewSeconds) {
    return {
      ok: false,
      status: 401,
      error: 'Unauthorized R2 upload request: token issued-at (iat) timestamp is in the future.',
    };
  }

  if (payload.email_verified !== true) {
    return {
      ok: false,
      status: 403,
      error:
        'Forbidden R2 upload request: Firebase account email must be verified (email_verified === true).',
    };
  }

  // Verify RS256 cryptographic signature against Google's Secure Token JWK public keys
  let jwkSet: GoogleJwkSet;
  try {
    jwkSet = await fetchGooglePublicJwkSet(options, false);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 401,
      error: `Unauthorized R2 upload request: could not verify token signing keys (${msg}).`,
    };
  }

  let matchingJwk = jwkSet.keys.find((k) => k.kid === header.kid && k.kty === 'RSA');
  if (!matchingJwk && !options?.customJwkSet) {
    try {
      jwkSet = await fetchGooglePublicJwkSet(options, true);
      matchingJwk = jwkSet.keys.find((k) => k.kid === header.kid && k.kty === 'RSA');
    } catch {
      // Handled below if matchingJwk remains undefined
    }
  }

  if (!matchingJwk) {
    return {
      ok: false,
      status: 401,
      error: `Unauthorized R2 upload request: unknown signing key ID (kid="${header.kid}").`,
    };
  }

  try {
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      matchingJwk,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
      },
      false,
      ['verify']
    );

    const signedDataBytes = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signatureValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      toCleanArrayBuffer(signatureBytes),
      toCleanArrayBuffer(signedDataBytes)
    );

    if (!signatureValid) {
      return {
        ok: false,
        status: 401,
        error:
          'Unauthorized R2 upload request: Firebase ID token cryptographic signature is invalid.',
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 401,
      error: `Unauthorized R2 upload request: failed to verify RSA signature (${msg}).`,
    };
  }

  // Check explicit CMS user authorization allowlist
  const allowlist = resolveAuthorizedCmsAllowlist(env);
  const normalizedEmail = (payload.email || '').trim().toLowerCase();
  const uid = payload.sub.trim();

  const isAuthorizedUser =
    allowlist.uids.has(uid) || (normalizedEmail.length > 0 && allowlist.emails.has(normalizedEmail));

  if (!isAuthorizedUser) {
    return {
      ok: false,
      status: 403,
      error: `Forbidden R2 upload request: signed-in Firebase user (${
        normalizedEmail || uid
      }) is not an authorized Science of Gifts CMS editor.`,
    };
  }

  return {
    ok: true,
    status: 200,
    uid,
    email: normalizedEmail,
    projectId: expectedProjectId,
    claims: payload,
  };
}
