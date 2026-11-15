import express from 'express';
import path from 'path';
import dns from 'dns/promises';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { isPrivateOrInternalHost } from './src/services/productExtractor';
import { processImageWithSharp } from './src/services/nodeSharpProcessor';
import {
  ServerEnvironment,
  handleAiAnalyzeHtmlRequest,
  handleAiGenerateRequest,
  handleAiStatusRequest,
  handleImageOptimizeRequest,
  handleImageOptimizerStatusRequest,
  handleImageUploadR2Request,
  handleProductFetchUrlRequest,
  handleProductParseHtmlRequest,
} from './src/services/serverApiHandlers';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

function getServerEnv(): ServerEnvironment {
  return {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    APP_URL: process.env.APP_URL,
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
    R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL,
    R2_UPLOAD_AUTH_TOKEN: process.env.R2_UPLOAD_AUTH_TOKEN,
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
    CMS_AUTHORIZED_EMAILS: process.env.CMS_AUTHORIZED_EMAILS,
    CMS_AUTHORIZED_UIDS: process.env.CMS_AUTHORIZED_UIDS,
  };
}

/**
 * Resolves a hostname via DNS and verifies none of its resolved IP addresses are private or internal.
 */
async function assertPublicDnsResolution(hostname: string): Promise<void> {
  if (isPrivateOrInternalHost(hostname)) {
    throw new Error('Target host is restricted (private or internal network).');
  }
  const records = await dns.lookup(hostname, { all: true });
  if (!records || records.length === 0) {
    throw new Error(`Could not resolve hostname "${hostname}".`);
  }
  for (const rec of records) {
    if (isPrivateOrInternalHost(rec.address)) {
      throw new Error('Resolved IP address points to a private or internal network (SSRF blocked).');
    }
  }
}

app.get('/api/ai/status', (_req, res) => {
  const result = handleAiStatusRequest(getServerEnv());
  res.status(result.status).json(result.body);
});

app.get('/api/images/status', (_req, res) => {
  const result = handleImageOptimizerStatusRequest(getServerEnv());
  res.status(result.status).json(result.body);
});

app.post('/api/images/optimize', async (req, res) => {
  const result = await handleImageOptimizeRequest(req.body, getServerEnv(), {
    assertPublicDns: assertPublicDnsResolution,
    imageProcessor: processImageWithSharp,
  });
  res.status(result.status).json(result.body);
});

app.post('/api/images/upload-r2', async (req, res) => {
  const result = await handleImageUploadR2Request(
    req.body,
    getServerEnv(),
    {
      authorization: req.header('authorization') || undefined,
    }
  );
  res.status(result.status).json(result.body);
});

app.post('/api/products/fetch-url', async (req, res) => {
  const result = await handleProductFetchUrlRequest(req.body, getServerEnv(), {
    assertPublicDns: assertPublicDnsResolution,
  });
  res.status(result.status).json(result.body);
});

app.post('/api/products/parse-html', async (req, res) => {
  const result = await handleProductParseHtmlRequest(req.body, getServerEnv(), {
    assertPublicDns: assertPublicDnsResolution,
  });
  res.status(result.status).json(result.body);
});

app.post('/api/ai/analyze-html', async (req, res) => {
  const result = await handleAiAnalyzeHtmlRequest(req.body, getServerEnv());
  res.status(result.status).json(result.body);
});

app.post('/api/ai/generate', async (req, res) => {
  const result = await handleAiGenerateRequest(req.body, getServerEnv());
  res.status(result.status).json(result.body);
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Science of Gifts CMS server running on http://localhost:${PORT}`);
  });
}

startServer();
