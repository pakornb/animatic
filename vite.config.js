import { resolve } from 'path';
import { defineConfig } from 'vite';

// COOP/COEP make SharedArrayBuffer available, which ffmpeg.wasm needs.
// These headers apply to the Vite dev server; Vercel gets them via vercel.json.
const isolation = {
  name: 'cross-origin-isolation',
  configureServer(server) {
    server.middlewares.use((_req, res, next) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((_req, res, next) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      next();
    });
  },
};

export default defineConfig({
  plugins: [isolation],
  // ffmpeg.wasm ships as an ESM worker; don't pre-bundle it
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  build: {
    target: 'es2020',
    rollupOptions: {
      input: {
        editor: resolve(__dirname, 'index.html'),
        viewer: resolve(__dirname, 'view.html'),
      },
    },
  },
});
