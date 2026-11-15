import {
  DEFAULT_CUSTOM_IMAGE_DOMAIN,
  buildPublicOptimizedImageUrl,
  normalizeCustomImageDomain,
  validateR2ObjectKey,
} from './imageOptimizerCore';
import {
  FirebaseAuthEnvironmentConfig,
  FirebaseTokenVerificationOptions,
  verifyFirebaseIdTokenForR2Upload,
} from './firebaseTokenVerifier';

export interface R2ObjectMeta {
  etag?: string;
  size?: number;
  customMetadata?: Record<string, string>;
}

export interface R2BucketBinding {
  head(key: string): Promise<R2ObjectMeta | null>;
  put(
    key: string,
    value: Uint8Array | ArrayBuffer,
    options?: {
      httpMetadata?: {
        contentType?: string;
        cacheControl?: string;
      };
      customMetadata?: Record<string, string>;
    }
  ): Promise<R2ObjectMeta | null>;
}

export interface R2EnvironmentConfig extends FirebaseAuthEnvironmentConfig {
  IMAGES_BUCKET?: R2BucketBinding;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  R2_PUBLIC_BASE_URL?: string;
  R2_UPLOAD_AUTH_TOKEN?: string;
}

export interface R2StatusReport {
  configured: boolean;
  mode: 'worker_binding' | 's3_api' | 'unconfigured';
  bucketName: string;
  publicBaseUrl: string;
  authRequired: boolean;
  missingVariables: string[];
  setupHint: string;
}

/**
 * Inspects server/Worker environment for R2 Bucket binding or S3-compatible R2 API credentials.
 * Never reads or exposes `VITE_` variables for R2 secrets, and never assumes a hardcoded bucket name.
 */
export function getR2ConfigurationStatus(env: R2EnvironmentConfig = {}): R2StatusReport {
  const publicBaseUrl = normalizeCustomImageDomain(
    env.R2_PUBLIC_BASE_URL || DEFAULT_CUSTOM_IMAGE_DOMAIN
  );
  const configuredBucketName =
    typeof env.R2_BUCKET_NAME === 'string' && env.R2_BUCKET_NAME.trim()
      ? env.R2_BUCKET_NAME.trim()
      : '';
  const authRequired = true;

  if (env.IMAGES_BUCKET && typeof env.IMAGES_BUCKET.put === 'function') {
    return {
      configured: true,
      mode: 'worker_binding',
      bucketName: configuredBucketName || 'IMAGES_BUCKET (Worker Binding)',
      publicBaseUrl,
      authRequired,
      missingVariables: [],
      setupHint: 'Cloudflare R2 Worker bucket binding (IMAGES_BUCKET) is active.',
    };
  }

  const requiredS3Vars: Array<keyof R2EnvironmentConfig> = [
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
  ];
  const missingVariables = requiredS3Vars.filter((k) => {
    const val = env[k];
    return typeof val !== 'string' || !val.trim();
  });

  if (missingVariables.length === 0) {
    return {
      configured: true,
      mode: 's3_api',
      bucketName: configuredBucketName,
      publicBaseUrl,
      authRequired,
      missingVariables: [],
      setupHint: 'Cloudflare R2 S3-compatible API credentials are configured.',
    };
  }

  return {
    configured: false,
    mode: 'unconfigured',
    bucketName: configuredBucketName,
    publicBaseUrl,
    authRequired,
    missingVariables,
    setupHint:
      'Configure an IMAGES_BUCKET binding in wrangler.toml or set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME in server/Worker secrets. You can still optimize images and download the WebP + Mapping ZIP archive.',
  };
}

/**
 * Verifies the binary starts with the RIFF....WEBP magic bytes (`52 49 46 46 ?? ?? ?? ?? 57 45 42 50`).
 */
export function isWebpBinary(bytes: Uint8Array): boolean {
  if (!bytes || bytes.byteLength < 12) return false;
  return (
    bytes[0] === 0x52 && // 'R'
    bytes[1] === 0x49 && // 'I'
    bytes[2] === 0x46 && // 'F'
    bytes[3] === 0x46 && // 'F'
    bytes[8] === 0x57 && // 'W'
    bytes[9] === 0x45 && // 'E'
    bytes[10] === 0x42 && // 'B'
    bytes[11] === 0x50 // 'P'
  );
}

function toCleanArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function computeSha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hashBuffer = await crypto.subtle.digest('SHA-256', toCleanArrayBuffer(bytes));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const keyBuffer = key instanceof Uint8Array ? toCleanArrayBuffer(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const msgBytes = new TextEncoder().encode(message);
  return crypto.subtle.sign('HMAC', cryptoKey, toCleanArrayBuffer(msgBytes));
}

async function deriveAwsSigV4SigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string
): Promise<ArrayBuffer> {
  const kSecret = new TextEncoder().encode(`AWS4${secretAccessKey}`);
  const kDate = await hmacSha256(kSecret, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

function toAmzDate(date = new Date()): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

/**
 * Signs and executes an S3-compatible request against Cloudflare R2 (`https://<accountId>.r2.cloudflarestorage.com`).
 */
async function executeR2S3Request(params: {
  method: 'HEAD' | 'PUT';
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  objectKey: string;
  bodyBytes?: Uint8Array;
  sha256Hex?: string;
  contentType?: string;
  cacheControl?: string;
  customFetch?: typeof fetch;
}): Promise<Response> {
  const fetchFn = params.customFetch || fetch;
  const host = `${params.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${encodeURIComponent(params.bucketName)}/${params.objectKey
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')}`;
  const endpointUrl = `https://${host}${canonicalUri}`;

  const { amzDate, dateStamp } = toAmzDate();
  const region = 'auto';
  const service = 's3';
  const payloadHash =
    params.method === 'PUT' && params.bodyBytes
      ? params.sha256Hex || (await computeSha256Hex(params.bodyBytes))
      : await computeSha256Hex('');

  const headersToSign: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };

  if (params.method === 'PUT') {
    headersToSign['content-type'] = params.contentType || 'image/webp';
    if (params.cacheControl) {
      headersToSign['cache-control'] = params.cacheControl;
    }
    if (params.sha256Hex) {
      headersToSign['x-amz-meta-sha256'] = params.sha256Hex;
    }
  }

  const sortedHeaderKeys = Object.keys(headersToSign).sort();
  const canonicalHeaders = sortedHeaderKeys
    .map((k) => `${k}:${headersToSign[k].trim()}\n`)
    .join('');
  const signedHeaders = sortedHeaderKeys.join(';');

  const canonicalRequest = [
    params.method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const canonicalRequestHash = await computeSha256Hex(canonicalRequest);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    canonicalRequestHash,
  ].join('\n');

  const signingKey = await deriveAwsSigV4SigningKey(
    params.secretAccessKey,
    dateStamp,
    region,
    service
  );
  const signatureBuffer = await hmacSha256(signingKey, stringToSign);
  const signatureHex = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signatureHex}`;

  const requestHeaders: Record<string, string> = {
    ...headersToSign,
    Authorization: authorizationHeader,
  };
  delete requestHeaders.host;

  return fetchFn(endpointUrl, {
    method: params.method,
    headers: requestHeaders,
    body:
      params.method === 'PUT' && params.bodyBytes
        ? toCleanArrayBuffer(params.bodyBytes)
        : undefined,
  });
}

export interface R2UploadRequestParams {
  objectKey: string;
  webpBytes: Uint8Array;
  contentType?: string;
  customDomain?: string;
  overwrite?: boolean;
  previousContentSha256?: string;
  authHeader?: string | null;
  cmsClientHeader?: string | null;
}

export interface R2UploadResult {
  ok: boolean;
  status: number;
  mode?: 'worker_binding' | 's3_api';
  objectKey?: string;
  publicUrl?: string;
  bytesUploaded?: number;
  sha256?: string;
  skippedDuplicate?: boolean;
  skippedUnchanged?: boolean;
  authenticatedUserEmail?: string;
  authenticatedUserUid?: string;
  error?: string;
}

export interface R2UploadOptions extends FirebaseTokenVerificationOptions {
  customFetch?: typeof fetch;
}

/**
 * Validates and uploads a WebP image to Cloudflare R2 (via Worker Bucket binding or S3 SigV4 API).
 * Requires a cryptographically verified Firebase Authentication ID token belonging to an
 * explicitly authorized Science of Gifts CMS user.
 */
export async function uploadWebpToCloudflareR2(
  params: R2UploadRequestParams,
  env: R2EnvironmentConfig,
  options?: R2UploadOptions
): Promise<R2UploadResult> {
  // 1. Verify Firebase ID token & CMS user authorization on the server/Worker
  const authVerification = await verifyFirebaseIdTokenForR2Upload(
    params.authHeader,
    env,
    options
  );
  if (!authVerification.ok) {
    return {
      ok: false,
      status: authVerification.status,
      error: authVerification.error,
    };
  }

  // 2. Validate object key to prevent path traversal or arbitrary object writes
  const keyCheck = validateR2ObjectKey(params.objectKey);
  if (!keyCheck.valid) {
    return {
      ok: false,
      status: 400,
      error: keyCheck.error || 'Invalid R2 object key.',
    };
  }

  // 3. Validate content type and WebP binary signature
  const contentType = (params.contentType || 'image/webp').toLowerCase().trim();
  if (contentType !== 'image/webp') {
    return {
      ok: false,
      status: 400,
      error: `Unsupported file type "${contentType}". Only "image/webp" is allowed.`,
    };
  }

  if (!params.webpBytes || !isWebpBinary(params.webpBytes)) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid image payload: file is not a valid WebP binary (missing RIFF/WEBP header).',
    };
  }

  if (params.webpBytes.byteLength > 10 * 1024 * 1024) {
    return {
      ok: false,
      status: 413,
      error: 'Optimized WebP file exceeds maximum allowed upload size (10 MB).',
    };
  }

  // 4. Check R2 configuration
  const r2Status = getR2ConfigurationStatus(env);
  if (!r2Status.configured) {
    return {
      ok: false,
      status: 503,
      error: `Cloudflare R2 is not configured on this server (${r2Status.missingVariables.join(
        ', '
      )} missing). ${r2Status.setupHint}`,
    };
  }

  const sha256 = await computeSha256Hex(params.webpBytes);
  const effectiveDomain = normalizeCustomImageDomain(
    params.customDomain || env.R2_PUBLIC_BASE_URL || DEFAULT_CUSTOM_IMAGE_DOMAIN
  );
  const publicUrl = buildPublicOptimizedImageUrl(effectiveDomain, params.objectKey);

  // Skip unchanged duplicate if previousContentSha256 matches and overwrite is false
  if (
    !params.overwrite &&
    params.previousContentSha256 &&
    params.previousContentSha256.trim().toLowerCase() === sha256.toLowerCase()
  ) {
    return {
      ok: true,
      status: 200,
      mode: r2Status.mode === 'worker_binding' ? 'worker_binding' : 's3_api',
      objectKey: params.objectKey,
      publicUrl,
      bytesUploaded: params.webpBytes.byteLength,
      sha256,
      skippedDuplicate: true,
      skippedUnchanged: true,
      authenticatedUserEmail: authVerification.email,
      authenticatedUserUid: authVerification.uid,
    };
  }

  // 5A. Upload via Cloudflare Worker R2 Bucket Binding (`env.IMAGES_BUCKET`)
  if (r2Status.mode === 'worker_binding' && env.IMAGES_BUCKET) {
    try {
      if (!params.overwrite && typeof env.IMAGES_BUCKET.head === 'function') {
        const existing = await env.IMAGES_BUCKET.head(params.objectKey);
        if (existing && existing.customMetadata?.sha256 === sha256) {
          return {
            ok: true,
            status: 200,
            mode: 'worker_binding',
            objectKey: params.objectKey,
            publicUrl,
            bytesUploaded: params.webpBytes.byteLength,
            sha256,
            skippedDuplicate: true,
            skippedUnchanged: true,
            authenticatedUserEmail: authVerification.email,
            authenticatedUserUid: authVerification.uid,
          };
        }
      }

      await env.IMAGES_BUCKET.put(params.objectKey, params.webpBytes, {
        httpMetadata: {
          contentType: 'image/webp',
          cacheControl: 'public, max-age=31536000, immutable',
        },
        customMetadata: {
          sha256,
          uploadedAt: new Date().toISOString(),
          uploadedByUid: authVerification.uid,
        },
      });

      return {
        ok: true,
        status: 200,
        mode: 'worker_binding',
        objectKey: params.objectKey,
        publicUrl,
        bytesUploaded: params.webpBytes.byteLength,
        sha256,
        skippedDuplicate: false,
        skippedUnchanged: false,
        authenticatedUserEmail: authVerification.email,
        authenticatedUserUid: authVerification.uid,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        status: 502,
        error: `Cloudflare R2 bucket binding upload failed: ${msg}`,
      };
    }
  }

  // 5B. Upload via S3-compatible Cloudflare R2 REST API
  try {
    const accountId = String(env.R2_ACCOUNT_ID).trim();
    const accessKeyId = String(env.R2_ACCESS_KEY_ID).trim();
    const secretAccessKey = String(env.R2_SECRET_ACCESS_KEY).trim();
    const bucketName = String(env.R2_BUCKET_NAME).trim();

    if (!params.overwrite) {
      try {
        const headRes = await executeR2S3Request({
          method: 'HEAD',
          accountId,
          accessKeyId,
          secretAccessKey,
          bucketName,
          objectKey: params.objectKey,
          customFetch: options?.customFetch,
        });
        if (headRes.ok) {
          const remoteHash = headRes.headers.get('x-amz-meta-sha256');
          const remoteLen = Number(headRes.headers.get('content-length') || 0);
          if (remoteHash === sha256 || (!remoteHash && remoteLen === params.webpBytes.byteLength)) {
            return {
              ok: true,
              status: 200,
              mode: 's3_api',
              objectKey: params.objectKey,
              publicUrl,
              bytesUploaded: params.webpBytes.byteLength,
              sha256,
              skippedDuplicate: true,
              skippedUnchanged: true,
              authenticatedUserEmail: authVerification.email,
              authenticatedUserUid: authVerification.uid,
            };
          }
        }
      } catch {
        // Proceed with PUT if HEAD check fails
      }
    }

    const putRes = await executeR2S3Request({
      method: 'PUT',
      accountId,
      accessKeyId,
      secretAccessKey,
      bucketName,
      objectKey: params.objectKey,
      bodyBytes: params.webpBytes,
      sha256Hex: sha256,
      contentType: 'image/webp',
      cacheControl: 'public, max-age=31536000, immutable',
      customFetch: options?.customFetch,
    });

    if (!putRes.ok) {
      const errText = await putRes.text().catch(() => '');
      return {
        ok: false,
        status: 502,
        error: `Cloudflare R2 returned HTTP ${putRes.status}: ${
          errText.slice(0, 240) || putRes.statusText || 'Upload rejected'
        }`,
      };
    }

    return {
      ok: true,
      status: 200,
      mode: 's3_api',
      objectKey: params.objectKey,
      publicUrl,
      bytesUploaded: params.webpBytes.byteLength,
      sha256,
      skippedDuplicate: false,
      skippedUnchanged: false,
      authenticatedUserEmail: authVerification.email,
      authenticatedUserUid: authVerification.uid,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 502,
      error: `Failed to upload WebP image to Cloudflare R2: ${msg}`,
    };
  }
}
