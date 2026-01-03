import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import sigilProofHandler from './api/proof/sigil.js';

function sigilProofApi() {
  const handler = async (req: Parameters<typeof sigilProofHandler>[0], res: Parameters<typeof sigilProofHandler>[1]) => {
    if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    await sigilProofHandler(req, res);
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

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['verahai-icon.svg'],
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
    ...(command === 'serve' ? [sigilProofApi()] : [])
  ]
}));
