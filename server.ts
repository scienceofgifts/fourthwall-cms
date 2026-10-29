import express from 'express';
import path from 'path';
import dns from 'dns/promises';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { isPrivateOrInternalHost } from './src/services/productExtractor';
import {
  ServerEnvironment,
  handleAiAnalyzeHtmlRequest,
  handleAiGenerateRequest,
  handleAiStatusRequest,
  handleProductFetchUrlRequest,
  handleProductParseHtmlRequest,
} from './src/services/serverApiHandlers';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '2mb' }));

function getServerEnv(): ServerEnvironment {
  return {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    APP_URL: process.env.APP_URL,
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
