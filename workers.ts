/**
 * Cloudflare Worker Entry Point (`workers.ts`)
 *
 * Serves both:
 * 1. Backend API routes (`/api/*`) using Worker environment secrets (`env.GEMINI_API_KEY`)
 *    and the centralized Gemini model fallback configuration.
 * 2. Static Vite frontend assets built into `./dist` via the `env.ASSETS` binding,
 *    preserving client-side SPA routing on `workers.dev`.
 */

import {
  ApiHandlerOptions,
  ServerEnvironment,
  handleAiAnalyzeHtmlRequest,
  handleAiGenerateRequest,
  handleAiStatusRequest,
  handleProductFetchUrlRequest,
  handleProductParseHtmlRequest,
} from './src/services/serverApiHandlers';

export interface AssetsFetcher {
  fetch(request: Request | string): Promise<Response>;
}

export interface WorkerEnv extends ServerEnvironment {
  GEMINI_API_KEY?: string;
  APP_URL?: string;
  ASSETS?: AssetsFetcher;
}

const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024; // 2 MB

const JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS,
  });
}

async function parseJsonBodySafely(
  request: Request
): Promise<
  | { ok: true; data: Record<string, any> }
  | { ok: false; status: number; error: string }
> {
  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isNaN(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
      return {
        ok: false,
        status: 413,
        error: 'Request payload exceeds the 2 MB size limit.',
      };
    }
  }

  let rawText = '';
  try {
    rawText = await request.text();
  } catch {
    return {
      ok: false,
      status: 400,
      error: 'Unable to read request body.',
    };
  }

  if (rawText.length > MAX_REQUEST_BODY_BYTES) {
    return {
      ok: false,
      status: 413,
      error: 'Request payload exceeds the 2 MB size limit.',
    };
  }

  if (!rawText.trim()) {
    return {
      ok: false,
      status: 400,
      error: 'Request body cannot be empty.',
    };
  }

  try {
    const parsed = JSON.parse(rawText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        status: 400,
        error: 'Expected a JSON object in the request body.',
      };
    }
    return { ok: true, data: parsed as Record<string, any> };
  } catch {
    return {
      ok: false,
      status: 400,
      error: 'Malformed JSON in request body.',
    };
  }
}

function isStaticAssetPathname(pathname: string): boolean {
  if (pathname.startsWith('/assets/')) return true;
  return /\.[a-zA-Z0-9]{1,8}$/.test(pathname) && !pathname.endsWith('.html');
}

export async function handleWorkerRequest(
  request: Request,
  env: WorkerEnv = {},
  handlerOptions?: ApiHandlerOptions
): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  // 1. Handle API Routes (`/api/*`)
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    if (pathname === '/api/ai/status') {
      if (method !== 'GET') {
        return jsonResponse(405, { error: 'Method Not Allowed. Use GET for /api/ai/status.' });
      }
      const res = handleAiStatusRequest(env);
      return jsonResponse(res.status, res.body);
    }

    if (
      pathname === '/api/products/fetch-url' ||
      pathname === '/api/products/parse-html' ||
      pathname === '/api/ai/analyze-html' ||
      pathname === '/api/ai/generate'
    ) {
      if (method !== 'POST') {
        return jsonResponse(405, { error: `Method Not Allowed. Use POST for ${pathname}.` });
      }

      const parsedBody = await parseJsonBodySafely(request);
      if (!parsedBody.ok) {
        return jsonResponse(parsedBody.status, { ok: false, error: parsedBody.error });
      }

      if (pathname === '/api/products/fetch-url') {
        const res = await handleProductFetchUrlRequest(parsedBody.data, env, handlerOptions);
        return jsonResponse(res.status, res.body);
      }

      if (pathname === '/api/products/parse-html') {
        const res = await handleProductParseHtmlRequest(parsedBody.data, env, handlerOptions);
        return jsonResponse(res.status, res.body);
      }

      if (pathname === '/api/ai/analyze-html') {
        const res = await handleAiAnalyzeHtmlRequest(parsedBody.data, env, handlerOptions);
        return jsonResponse(res.status, res.body);
      }

      if (pathname === '/api/ai/generate') {
        const res = await handleAiGenerateRequest(parsedBody.data, env, handlerOptions);
        return jsonResponse(res.status, res.body);
      }
    }

    return jsonResponse(404, { error: `API route not found: ${pathname}` });
  }

  // 2. Serve Static Frontend Assets & SPA Fallback via `env.ASSETS`
  if (method !== 'GET' && method !== 'HEAD') {
    return jsonResponse(405, { error: 'Method Not Allowed.' });
  }

  if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
    return new Response(
      'Frontend assets binding (ASSETS) is not configured on this Worker.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }

  const assetResponse = await env.ASSETS.fetch(request);
  if (assetResponse.status !== 404) {
    return assetResponse;
  }

  // If a static file with an extension (e.g. /assets/index.js) is missing, return the 404
  if (isStaticAssetPathname(url.pathname)) {
    return assetResponse;
  }

  // Otherwise, serve `/index.html` for SPA client-side routes
  const indexUrl = new URL('/index.html', request.url);
  const spaRequest = new Request(indexUrl.toString(), {
    method: request.method,
    headers: request.headers,
  });
  return env.ASSETS.fetch(spaRequest);
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleWorkerRequest(request, env);
  },
};
