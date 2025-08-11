import express from "express";
import { createServer } from "vite";
import app from './app.js';
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
    const port = process.env.PORT || 3000;

    // Client web:
    if (process.env.NODE_ENV === 'development') {
        // Serve client web through vite dev server:
        const viteDevServer = await createServer({
            server: {
                middlewareMode: true
            },
            root: path.resolve(__dirname, "../../client"),
            base: "/",
        });
        app.use(viteDevServer.middlewares);
        
        console.log(`🚀 Development server running on http://localhost:${port}`);
        console.log(`📦 Vite dev server integrated for client`);
    } else {
        // Serve pre-built web (npm run build)
        const clientDistPath = path.resolve(__dirname, "../../client/dist");
        app.use(express.static(clientDistPath));
        
        // Handle client-side routing - serve index.html for non-API routes
        app.get('*', (req, res) => {
            // Only serve index.html for non-API routes
            if (!req.path.startsWith('/api') && !req.path.startsWith('/health')) {
                res.sendFile(path.join(clientDistPath, 'index.html'));
            }
        });
        
        console.log(`🚀 Production server running on http://localhost:${port}`);
        console.log(`📁 Serving static files from: ${clientDistPath}`);
    }

    app.listen(port, () => {
        console.log(`Server environment: ${process.env.NODE_ENV || 'production'}`);
    });
})();
