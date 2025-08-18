import express from 'express';
import { createServer } from 'vite';
import app from './app.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
  const port = process.env.PORT || 5000;

  // Serve client web through vite dev server:
  const viteDevServer = await createServer({
    server: {
      middlewareMode: true,
    },
    root: path.resolve(__dirname, '../../client'),
    base: '/',
  });

  app.use(viteDevServer.middlewares);

  app.listen(port, () => {
    console.log(`🚀 Development server running on http://localhost:${port}`);
    console.log(`📦 Vite dev server integrated for client`);
  });
})();
