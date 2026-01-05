import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import sigilProofHandler from './api/proof/sigil.js';
import sigilSealHandler from './api/sigils/seal.js';
import sigilIdHandler from './api/sigils/[id].js';

const USE_EXTERNAL_PROOF_API = process.env.SIGIL_PROOF_API === 'external';
const PROOF_API_TARGET = process.env.SIGIL_PROOF_API_URL ?? 'http://localhost:8787';
const SIGIL_API_TARGET = process.env.SIGIL_API_URL ?? 'http://localhost:8787';
const USE_LOCAL_SIGIL_API = !process.env.SIGIL_API_URL;

function sigilProofApi() {
  const handler = async (req: unknown, res: unknown, next: () => void) => {
    const reqAny = req as { method?: string };
    const resAny = res as {
      statusCode?: number;
      setHeader: (name: string, value: string) => void;
      end: (chunk?: string) => void;
      writableEnded?: boolean;
    };
    if ((reqAny.method ?? 'GET').toUpperCase() !== 'POST') {
      resAny.statusCode = 405;
      resAny.setHeader('Content-Type', 'application/json');
      resAny.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    try {
      await sigilProofHandler(reqAny, resAny);
      if (!resAny.writableEnded && typeof next === 'function') next();
    } catch (error) {
      if (!resAny.writableEnded) {
        resAny.statusCode = 500;
        resAny.setHeader('Content-Type', 'application/json');
        resAny.end(JSON.stringify({ error: 'Proof handler failed to load' }));
      }
      if (typeof next === 'function') next(error as Error);
    }
  };

  return {
    name: 'sigil-proof-api',
    configureServer(server: { middlewares: { use: (path: string, cb: (req: unknown, res: unknown) => void) => void } }) {
      server.middlewares.use('/api/proof/sigil', handler);
    },
    configurePreviewServer(server: { middlewares: { use: (path: string, cb: (req: unknown, res: unknown) => void) => void } }) {
      server.middlewares.use('/api/proof/sigil', handler);
    }
  };
}

function localSigilApi() {
  const handler = async (req: unknown, res: unknown, next: () => void) => {
    const reqAny = req as { method?: string; url?: string; query?: Record<string, string> };
    const resAny = res as {
      statusCode?: number;
      setHeader: (name: string, value: string) => void;
      end: (chunk?: string) => void;
      writableEnded?: boolean;
    };

    const url = new URL(reqAny.url ?? '/', 'http://localhost');
    if (url.pathname === '/sigils/seal') {
      await sigilSealHandler(reqAny, resAny);
      if (!resAny.writableEnded && typeof next === 'function') next();
      return;
    }

    const sigilMatch = url.pathname.match(/^\/sigils\/([^/]+)\.svg$/);
    if (sigilMatch) {
      reqAny.query = { id: sigilMatch[1] };
      await sigilIdHandler(reqAny, resAny);
      if (!resAny.writableEnded && typeof next === 'function') next();
      return;
    }

    if (typeof next === 'function') next();
  };

  return {
    name: 'local-sigil-api',
    configureServer(server: { middlewares: { use: (cb: (req: unknown, res: unknown, next: () => void) => void) => void } }) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server: { middlewares: { use: (cb: (req: unknown, res: unknown, next: () => void) => void) => void } }) {
      server.middlewares.use(handler);
    }
  };
}

export default defineConfig(({ command }) => {
  const sigilProxy = {
    ...(USE_LOCAL_SIGIL_API
      ? {}
      : {
          '^/sigils': {
            target: SIGIL_API_TARGET,
            changeOrigin: true
          },
          '^/api/sigils': {
            target: SIGIL_API_TARGET,
            changeOrigin: true
          }
        }),
    ...(USE_EXTERNAL_PROOF_API
      ? {
          '^/api/proof/sigil': {
            target: PROOF_API_TARGET,
            changeOrigin: true
          }
        }
      : {})
  };

  const devServer = command === 'serve' ? { proxy: sigilProxy } : undefined;
  const previewServer = command === 'preview' ? { proxy: sigilProxy } : undefined;

  return {
    resolve: {
      alias: {
        html2canvas: '/src/shims/html2canvas.ts'
      }
    },
    server: devServer,
    preview: previewServer,
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['verahai-icon.svg', 'phi.svg'],
        manifest: {
          name: 'Verahai · SigilMarkets',
          short_name: 'Verahai',
          description: 'SigilMarkets for Kairos glyph prophecy markets.',
          theme_color: '#0f1115',
          background_color: '#0f1115',
          display: 'standalone',
          start_url: '/',
          icons: [
            {
              src: '/verahai-icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'maskable any'
            }
          ]
        }
      }),
      ...(USE_EXTERNAL_PROOF_API || !(command === 'serve' || command === 'preview') ? [] : [sigilProofApi()]),
      ...(USE_LOCAL_SIGIL_API && (command === 'serve' || command === 'preview') ? [localSigilApi()] : [])
    ]
  };
});
